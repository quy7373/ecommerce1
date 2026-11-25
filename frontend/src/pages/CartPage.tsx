import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2, ShoppingBag, RefreshCw, ArrowRight } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProductImage } from '@/components/ui/ProductImage';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/apiClient';
import { formatMoney, MAX_MONEY_CENTS } from '@/lib/money';
import { useCart } from '@/features/cart/CartContext';
import { StockBadge } from '@/features/products/StockBadge';

export function CartPage() {
  const { cart, loading, mutating, refreshCart, setItemQuantity, deleteItem } = useCart();
  const [error, setError] = useState<ApiError | null>(null);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [confirmRemoveItem, setConfirmRemoveItem] = useState<{
    productId: string;
    name: string;
  } | null>(null);

  const handleQuantityChange = async (productId: string, nextQty: number) => {
    if (nextQty < 1 || nextQty > 99) return;
    setError(null);
    setActiveProductId(productId);
    try {
      await setItemQuantity(productId, nextQty);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to update quantity.' })
      );
    } finally {
      setActiveProductId(null);
    }
  };

  const handleRemove = async (productId: string) => {
    setError(null);
    setActiveProductId(productId);
    try {
      await deleteItem(productId);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to remove item.' })
      );
    } finally {
      setActiveProductId(null);
    }
  };

  if (loading && !cart) {
    return <Spinner label="Loading your shopping cart..." />;
  }

  const items = cart?.items ?? [];
  const hasUnavailableItems = items.some(
    (item) => !item.product.active || item.product.availableQuantity < item.quantity
  );
  const exceedsOrderLimit = cart ? cart.grandTotal > MAX_MONEY_CENTS : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E6E4DD] pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#0F4C81]">Your Bag</p>
          <h1 className="mt-1 text-2xl font-bold text-[#11151C] sm:text-3xl">Shopping Cart</h1>
          {cart && (
            <p className="mt-1 text-sm text-[#555E6D] tabular-nums">
              {items.length} {items.length === 1 ? 'item' : 'items'} in cart
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          loading={loading}
          onClick={() => {
            setError(null);
            void refreshCart().catch((err) =>
              setError(
                err instanceof ApiError
                  ? err
                  : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to refresh cart.' })
              )
            );
          }}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          <span>Refresh cart</span>
        </Button>
      </div>

      {error && (
        <Alert
          tone="error"
          title={
            error.code === 'VERSION_CONFLICT'
              ? 'Cart updated in another session'
              : 'Cart update failed'
          }
          details={error.details}
          requestId={error.requestId}
        >
          {error.code === 'VERSION_CONFLICT'
            ? 'Your cart has been refreshed with the latest items. Review and repeat your change.'
            : error.message}
        </Alert>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="h-5 w-5" aria-hidden="true" />}
          title="Your cart is empty"
          description="Browse the catalog to add workspace hardware and desk goods."
          action={
            <Link to="/">
              <Button variant="primary">Browse catalog</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {hasUnavailableItems && (
              <Alert tone="warning" title="Adjust unavailable items before checkout">
                One or more items are archived or exceed available stock. Update quantities or
                remove unavailable items to continue.
              </Alert>
            )}

            {exceedsOrderLimit && (
              <Alert tone="error" title="Order total limit exceeded">
                Your cart exceeds the maximum single-order limit ($1,000,000.00). Reduce quantities
                before checking out.
              </Alert>
            )}

            <Card className="divide-y divide-[#EFEDE7] overflow-hidden">
              {items.map((item) => {
                const isBusy = mutating && activeProductId === item.product.id;
                const insufficient =
                  !item.product.active || item.product.availableQuantity < item.quantity;

                return (
                  <div
                    key={item.product.id}
                    className="flex flex-col gap-4 p-5 transition-colors hover:bg-[#FAF9F6]/60 sm:flex-row sm:items-center"
                  >
                    <Link
                      to={`/products/${item.product.id}`}
                      className="h-22 w-28 shrink-0 overflow-hidden rounded-xl border border-[#E6E4DD] bg-[#EFEDE7]"
                    >
                      <ProductImage
                        src={item.product.imageUrl}
                        alt={item.product.name}
                        className="h-full w-full"
                      />
                    </Link>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/products/${item.product.id}`}
                          className="font-semibold text-[#11151C] hover:text-[#0F4C81]"
                          style={{ fontFamily: 'var(--font-display)' }}
                        >
                          {item.product.name}
                        </Link>
                        <StockBadge
                          availableQuantity={item.product.availableQuantity}
                          active={item.product.active}
                        />
                      </div>
                      <p className="text-xs text-[#555E6D] tabular-nums">
                        {item.product.sku} — {formatMoney(item.product.price)} each
                      </p>
                      {insufficient && (
                        <p className="text-xs font-medium text-[#B42318]">
                          {!item.product.active
                            ? 'This product is no longer active. Remove it to proceed.'
                            : `Only ${item.product.availableQuantity} currently available.`}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <div
                        className="inline-flex items-center rounded-xl border border-[#D8D5CC] bg-white overflow-hidden"
                        aria-label={`Quantity for ${item.product.name}`}
                      >
                        <button
                          type="button"
                          disabled={isBusy || item.quantity <= 1}
                          onClick={() => handleQuantityChange(item.product.id, item.quantity - 1)}
                          aria-label={`Decrease quantity of ${item.product.name}`}
                          className="p-2 text-[#11151C] hover:bg-[#EFEDE7] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <span
                          className="min-w-9 text-center text-sm font-semibold text-[#11151C] tabular-nums"
                          aria-live="polite"
                        >
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          disabled={isBusy || item.quantity >= 99 || !item.product.active}
                          onClick={() => handleQuantityChange(item.product.id, item.quantity + 1)}
                          aria-label={`Increase quantity of ${item.product.name}`}
                          className="p-2 text-[#11151C] hover:bg-[#EFEDE7] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="min-w-20 text-right">
                        <p className="font-bold text-[#11151C] tabular-nums">
                          {formatMoney(item.lineTotal)}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          setConfirmRemoveItem({
                            productId: item.product.id,
                            name: item.product.name,
                          })
                        }
                        aria-label={`Remove ${item.product.name} from cart`}
                        className="rounded-lg p-2 text-[#6B7684] transition-colors hover:bg-[#FEF3F2] hover:text-[#B42318] disabled:opacity-40 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>

          <div>
            <Card className="sticky top-24 p-6 space-y-5">
              <h2 className="text-lg font-semibold text-[#11151C]">Order summary</h2>
              {cart && (
                <dl className="space-y-2.5 text-sm tabular-nums">
                  <div className="flex justify-between text-[#555E6D]">
                    <dt>Subtotal</dt>
                    <dd>{formatMoney(cart.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between text-[#555E6D]">
                    <dt>Shipping (demo)</dt>
                    <dd>{formatMoney(cart.shippingTotal)}</dd>
                  </div>
                  <div className="flex justify-between text-[#555E6D]">
                    <dt>Tax (demo)</dt>
                    <dd>{formatMoney(cart.taxTotal)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-[#EFEDE7] pt-3.5 text-base font-bold text-[#11151C]">
                    <dt>Total ({cart.currency})</dt>
                    <dd>{formatMoney(cart.grandTotal)}</dd>
                  </div>
                </dl>
              )}

              <Link
                to={hasUnavailableItems || exceedsOrderLimit ? '#' : '/checkout'}
                onClick={(e) => {
                  if (hasUnavailableItems || exceedsOrderLimit) e.preventDefault();
                }}
                className="block"
              >
                <Button
                  variant="primary"
                  size="lg"
                  disabled={hasUnavailableItems || exceedsOrderLimit || mutating}
                  className="w-full"
                >
                  <span>Proceed to Checkout</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Link>

              <p className="text-xs text-[#6B7684] leading-relaxed">
                Prices and stock levels are verified on the server when your order is created.
              </p>
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmRemoveItem)}
        onClose={() => setConfirmRemoveItem(null)}
        onConfirm={async () => {
          if (!confirmRemoveItem) return;
          await handleRemove(confirmRemoveItem.productId);
          setConfirmRemoveItem(null);
        }}
        loading={Boolean(confirmRemoveItem && mutating && activeProductId === confirmRemoveItem.productId)}
        title="Remove Item from Cart?"
        description={
          confirmRemoveItem
            ? `Are you sure you want to remove "${confirmRemoveItem.name}" from your shopping cart?`
            : ''
        }
        consequence="You can add this item again later from the catalog while it remains in stock."
        confirmLabel="Yes, Remove Item"
      />
    </div>
  );
}
