import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/apiClient';
import type { Cart } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { addCartItem, getCart, removeCartItem, updateCartItem } from './cartApi';

interface CartContextValue {
  cart: Cart | null;
  loading: boolean;
  mutating: boolean;
  itemCount: number;
  refreshCart: () => Promise<Cart | null>;
  addItem: (productId: string, quantity: number) => Promise<Cart>;
  setItemQuantity: (productId: string, quantity: number) => Promise<Cart>;
  deleteItem: (productId: string) => Promise<Cart>;
  clearLocalCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [cart, setCartState] = useState<Cart | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [pendingMutations, setPendingMutations] = useState<number>(0);

  // Always holds the latest committed cart so sequential mutations never read a stale version
  const cartRef = useRef<Cart | null>(null);
  // Serializes cart mutations so rapid clicks (e.g. adding multiple products) chain cleanly
  const mutationQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const setCart = useCallback((next: Cart | null) => {
    cartRef.current = next;
    setCartState(next);
  }, []);

  const clearLocalCart = useCallback(() => {
    setCart(null);
  }, [setCart]);

  const refreshCart = useCallback(async (): Promise<Cart | null> => {
    if (!isAuthenticated) {
      setCart(null);
      return null;
    }
    setLoading(true);
    try {
      const next = await getCart();
      setCart(next);
      return next;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setCart(null);
        return null;
      }
      throw err;
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, setCart]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setCart(null);
      return;
    }
    void refreshCart().catch(() => {
      // Handled gracefully on cart/checkout pages
    });
  }, [authLoading, isAuthenticated, refreshCart, setCart]);

  const ensureCartVersion = useCallback(async (): Promise<number> => {
    if (cartRef.current) return cartRef.current.version;
    const fetched = await getCart();
    setCart(fetched);
    return fetched.version;
  }, [setCart]);

  const enqueueMutation = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    setPendingMutations((count) => count + 1);
    const next = mutationQueueRef.current
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        setPendingMutations((count) => Math.max(0, count - 1));
      });
    mutationQueueRef.current = next;
    return next;
  }, []);

  const addItem = useCallback(
    (productId: string, quantity: number): Promise<Cart> =>
      enqueueMutation(async () => {
        try {
          const version = await ensureCartVersion();
          const updated = await addCartItem({ productId, quantity, cartVersion: version });
          setCart(updated);
          return updated;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
            // Sync latest version from server and retry once transparently
            const latest = await getCart();
            setCart(latest);
            const retried = await addCartItem({
              productId,
              quantity,
              cartVersion: latest.version,
            });
            setCart(retried);
            return retried;
          }
          throw err;
        }
      }),
    [enqueueMutation, ensureCartVersion, setCart]
  );

  const setItemQuantity = useCallback(
    (productId: string, quantity: number): Promise<Cart> =>
      enqueueMutation(async () => {
        try {
          const version = await ensureCartVersion();
          const updated = await updateCartItem(productId, { quantity, cartVersion: version });
          setCart(updated);
          return updated;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
            await refreshCart().catch(() => undefined);
          }
          throw err;
        }
      }),
    [enqueueMutation, ensureCartVersion, refreshCart, setCart]
  );

  const deleteItem = useCallback(
    (productId: string): Promise<Cart> =>
      enqueueMutation(async () => {
        try {
          const version = await ensureCartVersion();
          const updated = await removeCartItem(productId, version);
          setCart(updated);
          return updated;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
            await refreshCart().catch(() => undefined);
          }
          throw err;
        }
      }),
    [enqueueMutation, ensureCartVersion, refreshCart, setCart]
  );

  const itemCount = useMemo(
    () => (cart ? cart.items.reduce((sum, item) => sum + item.quantity, 0) : 0),
    [cart]
  );

  const mutating = pendingMutations > 0;

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      loading,
      mutating,
      itemCount,
      refreshCart,
      addItem,
      setItemQuantity,
      deleteItem,
      clearLocalCart,
    }),
    [cart, loading, mutating, itemCount, refreshCart, addItem, setItemQuantity, deleteItem, clearLocalCart]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within CartProvider');
  }
  return ctx;
}
