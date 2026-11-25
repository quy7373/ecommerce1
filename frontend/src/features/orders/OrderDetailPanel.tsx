import { Link } from 'react-router-dom';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { formatMoney } from '@/lib/money';
import { formatInstant } from '@/lib/validation';
import type { Order } from '@/lib/types';
import { OrderStatusBadge } from './OrderStatusBadge';

interface OrderDetailPanelProps {
  order: Order;
  onCancel?: (order: Order) => void;
  cancelling?: boolean;
  onDelete?: (order: Order) => void;
  deleting?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  cancellationPending?: boolean;
  isAdminView?: boolean;
  onAdvanceStatus?: (order: Order, nextStatus: 'PROCESSING' | 'SHIPPED') => void;
  advancingStatus?: boolean;
}

export function OrderDetailPanel({
  order,
  onCancel,
  cancelling = false,
  onDelete,
  deleting = false,
  onRefresh,
  refreshing = false,
  cancellationPending = false,
  isAdminView = false,
  onAdvanceStatus,
  advancingStatus = false,
}: OrderDetailPanelProps) {
  const canCustomerCancel =
    !isAdminView && order.status === 'PENDING_PAYMENT' && Boolean(onCancel);
  const canResumePayment =
    !isAdminView && order.status === 'PENDING_PAYMENT' && !order.cancellationRequestedAt;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#DDE2E7] pb-4">
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-[#525C68]">Order {order.id}</p>
          <p className="text-xs text-[#6B7684]">Placed {formatInstant(order.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <OrderStatusBadge status={order.status} />
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              loading={refreshing}
              onClick={onRefresh}
              aria-label="Refresh order status"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>Refresh</span>
            </Button>
          )}
        </div>
      </div>

      {(cancellationPending || order.cancellationRequestedAt) &&
        order.status === 'PENDING_PAYMENT' && (
          <Alert tone="warning" title="Cancellation pending provider confirmation">
            Your cancellation request is recorded. Select Refresh to check the confirmed final
            status from the payment provider.
          </Alert>
        )}

      {order.status === 'PAYMENT_REVIEW' && (
        <Alert tone="error" title="Payment under review">
          This order requires operator payment reconciliation before fulfillment.
        </Alert>
      )}

      <div>
        <h3 className="text-sm font-semibold text-[#161B22]">Items</h3>
        <ul className="mt-2 divide-y divide-[#DDE2E7] rounded-md border border-[#DDE2E7]">
          {order.items.map((item) => (
            <li
              key={`${item.productId}-${item.sku}`}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-[#161B22]">{item.name}</p>
                <p className="text-xs text-[#525C68] tabular-nums">
                  {item.sku} — {formatMoney(item.unitPrice)} × {item.quantity}
                </p>
              </div>
              <p className="font-semibold text-[#161B22] shrink-0 tabular-nums">
                {formatMoney(item.lineTotal)}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-[#DDE2E7] bg-[#F7F8F9] p-4 text-sm">
          <h3 className="font-semibold text-[#161B22]">Shipping address</h3>
          <address className="mt-2 not-italic text-[#525C68] space-y-0.5">
            <p className="font-medium text-[#161B22]">{order.shippingAddress.fullName}</p>
            <p>{order.shippingAddress.line1}</p>
            {order.shippingAddress.line2 && <p>{order.shippingAddress.line2}</p>}
            <p>
              {order.shippingAddress.city}, {order.shippingAddress.region}{' '}
              {order.shippingAddress.postalCode}
            </p>
            <p>{order.shippingAddress.country}</p>
            {order.shippingAddress.phone && <p>{order.shippingAddress.phone}</p>}
          </address>
        </div>

        <div className="rounded-md border border-[#DDE2E7] bg-[#F7F8F9] p-4 text-sm">
          <h3 className="font-semibold text-[#161B22]">Order summary</h3>
          <dl className="mt-2 space-y-1.5 tabular-nums">
            <div className="flex justify-between text-[#525C68]">
              <dt>Subtotal</dt>
              <dd>{formatMoney(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-[#525C68]">
              <dt>Shipping</dt>
              <dd>{formatMoney(order.shippingTotal)}</dd>
            </div>
            <div className="flex justify-between text-[#525C68]">
              <dt>Tax</dt>
              <dd>{formatMoney(order.taxTotal)}</dd>
            </div>
            <div className="flex justify-between border-t border-[#DDE2E7] pt-2 font-bold text-[#161B22]">
              <dt>Total ({order.currency})</dt>
              <dd>{formatMoney(order.grandTotal)}</dd>
            </div>
          </dl>
          <div className="mt-3 space-y-1 border-t border-[#DDE2E7] pt-2 text-xs text-[#6B7684]">
            <p>Reservation expires {formatInstant(order.reservationExpiresAt)}</p>
            {order.paidAt && <p>Paid {formatInstant(order.paidAt)}</p>}
            {order.cancellationRequestedAt && (
              <p>Cancellation requested {formatInstant(order.cancellationRequestedAt)}</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#DDE2E7] pt-4">
        {canResumePayment && (
          <Link to={`/checkout?orderId=${encodeURIComponent(order.id)}`}>
            <Button variant="primary">Complete payment</Button>
          </Link>
        )}
        {canCustomerCancel && (
          <Button variant="danger" loading={cancelling} onClick={() => onCancel?.(order)}>
            Cancel Pending Order
          </Button>
        )}
        {!isAdminView && onDelete && (
          <Button variant="danger" loading={deleting} onClick={() => onDelete(order)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span>Delete Order</span>
          </Button>
        )}
        {isAdminView && onAdvanceStatus && order.status === 'PAID' && (
          <Button
            variant="primary"
            loading={advancingStatus}
            onClick={() => onAdvanceStatus(order, 'PROCESSING')}
          >
            Mark as Processing
          </Button>
        )}
        {isAdminView && onAdvanceStatus && order.status === 'PROCESSING' && (
          <Button
            variant="primary"
            loading={advancingStatus}
            onClick={() => onAdvanceStatus(order, 'SHIPPED')}
          >
            Mark as Shipped
          </Button>
        )}
      </div>
    </div>
  );
}
