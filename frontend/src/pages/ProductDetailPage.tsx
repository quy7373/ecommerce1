import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, Check, ShieldCheck, PackageCheck, Truck } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ProductImage } from '@/components/ui/ProductImage';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/apiClient';
import { formatMoney } from '@/lib/money';
import type { Product } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { useCart } from '@/features/cart/CartContext';
import { getProduct } from '@/features/products/productsApi';
import { StockBadge } from '@/features/products/StockBadge';

export function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { addItem } = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(
    null
  );

  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getProduct(productId, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setProduct(data);
          setQuantity(1);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof ApiError
            ? err
            : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to load product.' })
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [productId]);

  const handleAddToCart = async () => {
    if (!product) return;
    setAddStatus(null);

    if (!isAuthenticated) {
      navigate('/login', { state: { from: `/products/${product.id}` } });
      return;
    }

    setAdding(true);
    try {
      await addItem(product.id, quantity);
      setAddStatus({
        tone: 'success',
        message: `Added ${quantity} × "${product.name}" to your cart.`,
      });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setAddStatus({
        tone: 'error',
        message: apiErr ? apiErr.message : 'Unable to add this product to your cart.',
      });
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return <Spinner label="Loading product details..." />;
  }

  if (error || !product) {
    return (
      <div className="space-y-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0F4C81] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to catalog</span>
        </Link>
        <Alert
          tone="error"
          title={error?.code === 'NOT_FOUND' ? 'Product not found' : 'Could not load product'}
          requestId={error?.requestId}
        >
          {error?.message || 'This product is unavailable or does not exist.'}
        </Alert>
      </div>
    );
  }

  const maxOrderQty = Math.min(99, Math.max(1, product.availableQuantity));
  const unavailable = !product.active || product.availableQuantity <= 0;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-[#E6E4DD] bg-white px-3.5 py-1.5 text-xs font-medium text-[#555E6D] transition-colors hover:border-[#CBC7BC] hover:text-[#11151C]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to catalog</span>
        </Link>
      </nav>

      <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-7">
          <div className="aspect-[4/3] overflow-hidden rounded-3xl border border-[#E6E4DD] bg-[#EFEDE7] shadow-[0_2px_12px_rgba(17,21,28,0.05)]">
            <ProductImage
              src={product.imageUrl}
              alt={product.name}
              priority
              className="h-full w-full"
            />
          </div>
        </div>

        <Card className="lg:col-span-5 p-6 sm:p-8 flex flex-col space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wider text-[#0F4C81]">
                {product.category.name}
              </span>
              <span className="rounded-md bg-[#F3F2EE] px-2 py-0.5 font-mono text-[11px] text-[#555E6D]">
                SKU {product.sku}
              </span>
            </div>

            <h1 className="text-2xl font-bold text-[#11151C] sm:text-3xl leading-tight">
              {product.name}
            </h1>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <p
                className="text-3xl font-bold text-[#11151C] tabular-nums"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {formatMoney(product.price)}
              </p>
              <StockBadge availableQuantity={product.availableQuantity} active={product.active} />
            </div>
          </div>

          <div className="border-t border-[#EFEDE7] pt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#555E6D]">
              Overview
            </h2>
            <p className="mt-2 max-w-prose whitespace-pre-line text-sm leading-relaxed text-[#3E4752]">
              {product.description || 'No description provided.'}
            </p>
          </div>

          <div className="grid gap-2.5 rounded-xl bg-[#FAF9F6] border border-[#EFEDE7] p-4 text-xs text-[#555E6D]">
            <div className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-[#157347] shrink-0" aria-hidden="true" />
              <span>Real-time stock reserved atomically when you place an order.</span>
            </div>
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-[#0F4C81] shrink-0" aria-hidden="true" />
              <span>US test-market shipping with server-verified totals.</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#0F4C81] shrink-0" aria-hidden="true" />
              <span>Card details handled strictly on hosted Stripe Checkout.</span>
            </div>
          </div>

          {addStatus && (
            <Alert tone={addStatus.tone}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{addStatus.message}</span>
                {addStatus.tone === 'success' && (
                  <Link to="/cart" className="font-semibold underline hover:no-underline">
                    View cart
                  </Link>
                )}
              </div>
            </Alert>
          )}

          <div className="flex flex-wrap items-end gap-3 border-t border-[#EFEDE7] pt-5">
            <div className="w-24">
              <label
                htmlFor="product-detail-qty"
                className="block text-xs font-medium text-[#11151C] mb-1.5"
              >
                Quantity
              </label>
              <input
                id="product-detail-qty"
                type="number"
                min={1}
                max={maxOrderQty}
                disabled={unavailable || adding}
                value={quantity}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isInteger(next) && next >= 1 && next <= maxOrderQty) {
                    setQuantity(next);
                  }
                }}
                className="block w-full rounded-xl border border-[#D8D5CC] bg-white px-3 py-2.5 text-sm font-medium text-[#11151C] tabular-nums focus:border-[#0F4C81] focus:ring-3 focus:ring-[#0F4C81]/15 disabled:bg-[#EFEDE7]"
              />
            </div>

            <Button
              size="lg"
              variant="primary"
              disabled={unavailable}
              loading={adding}
              onClick={handleAddToCart}
              className="flex-1 min-w-44"
            >
              {addStatus?.tone === 'success' ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ShoppingCart className="h-4 w-4" aria-hidden="true" />
              )}
              <span>
                {unavailable
                  ? 'Out of stock'
                  : isAuthenticated
                  ? 'Add to cart'
                  : 'Sign in to add'}
              </span>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
