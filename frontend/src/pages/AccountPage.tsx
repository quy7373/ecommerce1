import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut, Package, Eye, Trash2, User as UserIcon } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/apiClient';
import { formatMoney } from '@/lib/money';
import { formatInstant } from '@/lib/validation';
import type { Order, OrderStatus, Page } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { useCart } from '@/features/cart/CartContext';
import { cancelOrder, deleteOrder, getOrder, listOrders } from '@/features/orders/ordersApi';
import { OrderStatusBadge } from '@/features/orders/OrderStatusBadge';
import { OrderDetailPanel } from '@/features/orders/OrderDetailPanel';
import { Pagination } from '@/features/products/Pagination';

const ORDER_STATUS_FILTERS: { value: '' | OrderStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING_PAYMENT', label: 'Pending Payment' },
  { value: 'PAID', label: 'Paid' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'SHIPPED', label: 'Shipped' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'PAYMENT_REVIEW', label: 'Payment Review' },
];

export function AccountPage() {
  const { user, expiresAt, logout } = useAuth();
  const { clearLocalCart } = useCart();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const returnedOrderId = searchParams.get('orderId');
  const paymentHint = searchParams.get('payment');

  const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('');
  const [page, setPage] = useState(1);
  const [ordersPage, setOrdersPage] = useState<Page<Order> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancellationPending, setCancellationPending] = useState(false);
  const [detailError, setDetailError] = useState<ApiError | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listOrders({
        page,
        pageSize: 10,
        status: statusFilter || undefined,
      });
      setOrdersPage(result);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to load orders.' })
      );
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const openOrderDetail = useCallback(async (orderId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setCancellationPending(false);
    try {
      const order = await getOrder(orderId);
      setSelectedOrder(order);
    } catch (err) {
      setDetailError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to load order.' })
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (returnedOrderId) {
      void openOrderDetail(returnedOrderId);
    }
  }, [returnedOrderId, openOrderDetail]);

  const handleCloseDetail = () => {
    setSelectedOrder(null);
    setDetailError(null);
    setCancellationPending(false);
    if (returnedOrderId || paymentHint) {
      setSearchParams({}, { replace: true });
    }
  };

  const handleCancelOrder = async (order: Order) => {
    setCancelling(true);
    setDetailError(null);
    try {
      const res = await cancelOrder(order.id);
      setSelectedOrder(res.order);
      setCancellationPending(res.pending);
      void loadOrders();
    } catch (err) {
      const apiErr =
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Cancellation failed.' });
      setDetailError(apiErr);
      if (apiErr.code === 'ORDER_NOT_CANCELLABLE') {
        void getOrder(order.id)
          .then(setSelectedOrder)
          .catch(() => undefined);
        void loadOrders();
      }
    } finally {
      setCancelling(false);
    }
  };

  const handleConfirmDeleteOrder = async () => {
    if (!orderToDelete) return;
    setDeletingOrder(true);
    setError(null);
    try {
      await deleteOrder(orderToDelete.id);
      if (selectedOrder?.id === orderToDelete.id) {
        handleCloseDetail();
      }
      setOrderToDelete(null);
      await loadOrders();
    } catch (err) {
      const apiErr =
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to delete order.' });
      setError(apiErr);
      setOrderToDelete(null);
    } finally {
      setDeletingOrder(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      clearLocalCart();
      navigate('/');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E6E4DD] pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#0F4C81]">Member Portal</p>
          <h1 className="mt-1 text-2xl font-bold text-[#11151C] sm:text-3xl">Account & Order History</h1>
        </div>
        <Button variant="outline" loading={loggingOut} onClick={handleLogout}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span>Sign out</span>
        </Button>
      </div>

      {paymentHint === 'returned' && (
        <Alert tone="info" title="Returned from Stripe Checkout">
          Order status below reflects the server&apos;s verified payment state. If payment is still
          confirming, select Refresh inside the order details.
        </Alert>
      )}

      {user && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#EDF4FA] text-[#0F4C81] border border-[#C4DCF0]">
                <UserIcon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-[#161B22]">{user.displayName}</h2>
                  <Badge tone={user.role === 'ADMIN' ? 'info' : 'neutral'}>{user.role}</Badge>
                </div>
                <p className="text-sm text-[#525C68]">{user.email}</p>
              </div>
            </div>
            {expiresAt && (
              <p className="text-xs text-[#6B7684]">Session expires {formatInstant(expiresAt)}</p>
            )}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-[#161B22]">Orders</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="order-status-filter" className="text-sm font-medium text-[#525C68]">
            Status
          </label>
          <select
            id="order-status-filter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as '' | OrderStatus);
              setPage(1);
            }}
            className="rounded border border-[#CBD2D9] bg-white px-3 py-1.5 text-sm text-[#161B22] focus:border-[#0F4C81] focus:ring-2 focus:ring-[#0F4C81]/15"
          >
            {ORDER_STATUS_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <Alert
          tone="error"
          title="Could not load orders"
          details={error.details}
          requestId={error.requestId}
        >
          {error.message}
        </Alert>
      )}

      {loading ? (
        <Spinner label="Loading order history..." />
      ) : !ordersPage || ordersPage.data.length === 0 ? (
        <EmptyState
          icon={<Package className="h-5 w-5" aria-hidden="true" />}
          title="No orders found"
          description={
            statusFilter
              ? 'No orders match the selected status filter.'
              : 'Orders you place appear here with full purchase and shipping details.'
          }
        />
      ) : (
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[#DDE2E7] text-sm">
                <thead className="bg-[#ECEFF2] text-left text-xs font-semibold text-[#525C68]">
                  <tr>
                    <th className="px-4 py-3">Order ID</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Items</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DDE2E7] bg-white">
                  {ordersPage.data.map((order) => (
                    <tr key={order.id} className="hover:bg-[#F7F8F9]">
                      <td className="px-4 py-3 text-xs text-[#525C68] tabular-nums">
                        {order.id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3 text-[#525C68]">{formatInstant(order.createdAt)}</td>
                      <td className="px-4 py-3 text-[#161B22] tabular-nums">
                        {order.items.reduce((sum, i) => sum + i.quantity, 0)}
                      </td>
                      <td className="px-4 py-3">
                        <OrderStatusBadge status={order.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#161B22] tabular-nums">
                        {formatMoney(order.grandTotal)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void openOrderDetail(order.id)}
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Details</span>
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setOrderToDelete(order)}
                            aria-label={`Delete order ${order.id.slice(0, 8)}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Delete</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Pagination pagination={ordersPage.pagination} onPageChange={setPage} />
        </div>
      )}

      <Modal
        open={Boolean(selectedOrder) || detailLoading || Boolean(detailError)}
        onClose={handleCloseDetail}
        title="Order Details"
        maxWidthClass="max-w-2xl"
      >
        {detailLoading && !selectedOrder ? (
          <Spinner label="Loading order details..." />
        ) : (
          <div className="space-y-4">
            {detailError && (
              <Alert
                tone="error"
                title="Order action failed"
                details={detailError.details}
                requestId={detailError.requestId}
              >
                {detailError.message}
              </Alert>
            )}
            {selectedOrder && (
              <OrderDetailPanel
                order={selectedOrder}
                onCancel={handleCancelOrder}
                cancelling={cancelling}
                onDelete={(order) => setOrderToDelete(order)}
                deleting={deletingOrder && orderToDelete?.id === selectedOrder.id}
                cancellationPending={cancellationPending}
                onRefresh={() => void openOrderDetail(selectedOrder.id)}
                refreshing={detailLoading}
              />
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(orderToDelete)}
        onClose={() => {
          if (!deletingOrder) setOrderToDelete(null);
        }}
        onConfirm={handleConfirmDeleteOrder}
        title="Delete order?"
        description={
          orderToDelete
            ? `Are you sure you want to permanently delete order ${orderToDelete.id.slice(0, 8)}… (${formatMoney(orderToDelete.grandTotal)})?`
            : ''
        }
        consequence={
          orderToDelete?.status === 'PENDING_PAYMENT'
            ? 'This action cannot be undone. Any reserved inventory will be released and the order record will be permanently removed.'
            : 'This action cannot be undone. The order record and its payment history will be permanently removed.'
        }
        confirmLabel="Delete Order"
        loading={deletingOrder}
      />
    </div>
  );
}
