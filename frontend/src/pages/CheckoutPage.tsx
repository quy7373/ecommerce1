import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CreditCard, Lock, ArrowLeft } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/apiClient';
import { generateIdempotencyKey } from '@/lib/idempotency';
import { formatMoney } from '@/lib/money';
import { isSafeStripeCheckoutUrl, validateShippingAddress } from '@/lib/validation';
import type { Order } from '@/lib/types';
import { useCart } from '@/features/cart/CartContext';
import { cancelOrder, createOrder, getOrder } from '@/features/orders/ordersApi';
import { OrderStatusBadge } from '@/features/orders/OrderStatusBadge';
import { createCheckoutSession } from '@/features/checkout/checkoutApi';
import {
  ShippingAddressForm,
  type ShippingFormValues,
} from '@/features/checkout/ShippingAddressForm';

const INITIAL_FORM: ShippingFormValues = {
  fullName: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  phone: '',
};

export function CheckoutPage() {
  const [searchParams] = useSearchParams();
  const existingOrderId = searchParams.get('orderId');
  const paymentHint = searchParams.get('payment');

  const { cart, loading: cartLoading, refreshCart } = useCart();

  const [formValues, setFormValues] = useState<ShippingFormValues>(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [existingOrder, setExistingOrder] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState<boolean>(Boolean(existingOrderId));
  const [cancellingOrder, setCancellingOrder] = useState(false);

  const orderIdempotencyKeyRef = useRef<string>(generateIdempotencyKey('ord'));
  const checkoutIdempotencyKeyRef = useRef<string>(generateIdempotencyKey('chk'));

  const loadExistingOrder = useCallback(async (orderId: string) => {
    setLoadingOrder(true);
    setApiError(null);
    try {
      const order = await getOrder(orderId);
      setExistingOrder(order);
    } catch (err) {
      setApiError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to load order.' })
      );
    } finally {
      setLoadingOrder(false);
    }
  }, []);

  useEffect(() => {
    if (existingOrderId) {
      void loadExistingOrder(existingOrderId);
    }
  }, [existingOrderId, loadExistingOrder]);

  const handleFieldChange = (field: keyof ShippingFormValues, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const copy = { ...prev };
      delete copy[field];
      return copy;
    });
    orderIdempotencyKeyRef.current = generateIdempotencyKey('ord');
  };

  const redirectToStripe = async (orderId: string) => {
    const checkout = await createCheckoutSession(orderId, checkoutIdempotencyKeyRef.current);
    if (!isSafeStripeCheckoutUrl(checkout.checkoutUrl)) {
      throw new ApiError({
        status: 502,
        code: 'INVALID_CHECKOUT_URL',
        message: 'Received an untrusted payment checkout URL. Redirect aborted.',
      });
    }
    window.location.assign(checkout.checkoutUrl);
  };

  const handleSubmitNewOrder = async (e: FormEvent) => {
    e.preventDefault();
    setApiError(null);
    setStatusMessage(null);

    const validation = validateShippingAddress(formValues);
    if (!validation.valid || !validation.normalized) {
      setFieldErrors(validation.errors);
      return;
    }

    if (!cart || cart.items.length === 0) {
      setApiError(
        new ApiError({
          status: 409,
          code: 'CART_EMPTY',
          message: 'Your cart is empty. Add items before checking out.',
        })
      );
      return;
    }

    setSubmitting(true);
    try {
      const createdOrder = await createOrder(
        {
          cartVersion: cart.version,
          shippingAddress: validation.normalized,
        },
        orderIdempotencyKeyRef.current
      );
      setExistingOrder(createdOrder);
      void refreshCart().catch(() => undefined);
      await redirectToStripe(createdOrder.id);
    } catch (err) {
      const normalized =
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Checkout failed.' });
      setApiError(normalized);

      if (normalized.code === 'VALIDATION_ERROR' && normalized.details.length > 0) {
        const mapped: Record<string, string> = {};
        for (const d of normalized.details) {
          const shortField = d.field.replace(/^shippingAddress\./, '');
          mapped[shortField] = d.message;
        }
        setFieldErrors(mapped);
      }

      if (normalized.code === 'VERSION_CONFLICT') {
        void refreshCart().catch(() => undefined);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleResumePayment = async () => {
    if (!existingOrder) return;
    setApiError(null);
    setSubmitting(true);
    try {
      await redirectToStripe(existingOrder.id);
    } catch (err) {
      setApiError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Unable to start payment.' })
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelExistingOrder = async () => {
    if (!existingOrder) return;
    setApiError(null);
    setCancellingOrder(true);
    try {
      const result = await cancelOrder(existingOrder.id);
      setExistingOrder(result.order);
      setStatusMessage(
        result.pending
          ? 'Cancellation requested and awaiting payment provider confirmation.'
          : 'Order cancelled and reserved inventory released.'
      );
    } catch (err) {
      setApiError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Cancellation failed.' })
      );
    } finally {
      setCancellingOrder(false);
    }
  };

  if (existingOrderId) {
    if (loadingOrder) {
      return <Spinner label="Loading order for checkout..." />;
    }

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          to="/account"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0F4C81] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to account and orders</span>
        </Link>

        <h1 className="text-2xl font-bold text-[#161B22]">Complete Order Payment</h1>

        {paymentHint === 'cancelled' && (
          <Alert tone="warning" title="Stripe Checkout was cancelled">
            Your order remains pending until paid, cancelled, or expired. Resume payment below or
            cancel the order.
          </Alert>
        )}

        {statusMessage && <Alert tone="info">{statusMessage}</Alert>}

        {apiError && (
          <Alert
            tone="error"
            title="Checkout error"
            details={apiError.details}
            requestId={apiError.requestId}
          >
            {apiError.message}
          </Alert>
        )}

        {existingOrder && (
          <Card className="p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DDE2E7] pb-4">
              <div>
                <p className="text-xs text-[#525C68]">Order {existingOrder.id}</p>
                <p className="text-lg font-bold text-[#161B22] tabular-nums">
                  Total {formatMoney(existingOrder.grandTotal)} ({existingOrder.currency})
                </p>
              </div>
              <OrderStatusBadge status={existingOrder.status} />
            </div>

            <ul className="divide-y divide-[#DDE2E7] text-sm">
              {existingOrder.items.map((item) => (
                <li key={`${item.productId}-${item.sku}`} className="flex justify-between py-2.5">
                  <span>
                    {item.name} × {item.quantity}
                  </span>
                  <span className="font-medium tabular-nums">{formatMoney(item.lineTotal)}</span>
                </li>
              ))}
            </ul>

            {existingOrder.status === 'PENDING_PAYMENT' && !existingOrder.cancellationRequestedAt ? (
              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  variant="primary"
                  size="lg"
                  loading={submitting}
                  onClick={handleResumePayment}
                  className="flex-1"
                >
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                  <span>Pay with Stripe Checkout</span>
                </Button>
                <Button
                  variant="danger"
                  size="lg"
                  loading={cancellingOrder}
                  onClick={handleCancelExistingOrder}
                >
                  Cancel order
                </Button>
              </div>
            ) : (
              <Link to="/account" className="block">
                <Button variant="outline" className="w-full">
                  View order in account
                </Button>
              </Link>
            )}
          </Card>
        )}
      </div>
    );
  }

  if (cartLoading && !cart) {
    return <Spinner label="Preparing checkout..." />;
  }

  if (!cart || cart.items.length === 0) {
    return (
      <EmptyState
        title="Nothing to check out"
        description="Your cart is empty. Add items before checking out."
        action={
          <Link to="/">
            <Button variant="primary">Return to catalog</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-[#E6E4DD] pb-5">
        <Link
          to="/cart"
          className="inline-flex items-center gap-1.5 rounded-full border border-[#E6E4DD] bg-white px-3.5 py-1.5 text-xs font-medium text-[#555E6D] transition-colors hover:border-[#CBC7BC] hover:text-[#11151C]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to cart</span>
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-[#11151C] sm:text-3xl">Checkout</h1>
      </div>

      {apiError && (
        <Alert
          tone="error"
          title="Unable to complete checkout"
          details={apiError.details}
          requestId={apiError.requestId}
        >
          {apiError.message}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold text-[#161B22] mb-5">Shipping information</h2>
          <form onSubmit={handleSubmitNewOrder} noValidate className="space-y-6">
            <ShippingAddressForm
              values={formValues}
              errors={fieldErrors}
              disabled={submitting}
              onChange={handleFieldChange}
            />

            <div className="border-t border-[#DDE2E7] pt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-xs text-[#525C68]">
                <Lock className="h-4 w-4 text-[#1E6F50] shrink-0" aria-hidden="true" />
                <span>Card details are entered on hosted Stripe Checkout.</span>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={submitting}
                className="sm:min-w-52"
              >
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                <span>Place Order & Pay</span>
              </Button>
            </div>
          </form>
        </Card>

        <div>
          <Card className="sticky top-24 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#161B22]">Order summary</h2>
            <ul className="divide-y divide-[#DDE2E7] text-sm">
              {cart.items.map((item) => (
                <li key={item.product.id} className="flex justify-between gap-2 py-2.5">
                  <span className="text-[#525C68]">
                    {item.product.name} × {item.quantity}
                  </span>
                  <span className="font-medium text-[#161B22] shrink-0 tabular-nums">
                    {formatMoney(item.lineTotal)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="space-y-2 border-t border-[#DDE2E7] pt-3 text-sm tabular-nums">
              <div className="flex justify-between text-[#525C68]">
                <dt>Subtotal</dt>
                <dd>{formatMoney(cart.subtotal)}</dd>
              </div>
              <div className="flex justify-between text-[#525C68]">
                <dt>Shipping</dt>
                <dd>{formatMoney(cart.shippingTotal)}</dd>
              </div>
              <div className="flex justify-between text-[#525C68]">
                <dt>Tax</dt>
                <dd>{formatMoney(cart.taxTotal)}</dd>
              </div>
              <div className="flex justify-between border-t border-[#DDE2E7] pt-3 text-base font-bold text-[#161B22]">
                <dt>Total ({cart.currency})</dt>
                <dd>{formatMoney(cart.grandTotal)}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
