import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Archive, Eye, Package, ClipboardList, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/apiClient';
import { formatMoney } from '@/lib/money';
import { formatInstant } from '@/lib/validation';
import type { Category, Order, OrderStatus, Page, Product } from '@/lib/types';
import {
  archiveAdminProduct,
  listAdminProducts,
  listCategories,
} from '@/features/products/productsApi';
import { StockBadge } from '@/features/products/StockBadge';
import { Pagination } from '@/features/products/Pagination';
import { AdminProductFormModal } from '@/features/products/AdminProductFormModal';
import {
  deleteAdminOrder,
  getAdminOrder,
  listAdminOrders,
  updateAdminOrderStatus,
} from '@/features/orders/ordersApi';
import { OrderStatusBadge } from '@/features/orders/OrderStatusBadge';
import { OrderDetailPanel } from '@/features/orders/OrderDetailPanel';
import { AdminOrderFormModal } from '@/features/orders/AdminOrderFormModal';

type AdminTab = 'products' | 'orders';

const ADMIN_ORDER_STATUSES: { value: '' | OrderStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING_PAYMENT', label: 'Pending Payment' },
  { value: 'PAID', label: 'Paid' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'SHIPPED', label: 'Shipped' },
  { value: 'PAYMENT_REVIEW', label: 'Payment Review' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
];

export function AdminDashboardPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('products');
  const [categories, setCategories] = useState<Category[]>([]);

  const [productsPage, setProductsPage] = useState<Page<Product> | null>(null);
  const [productPageNum, setProductPageNum] = useState(1);
  const [productActiveFilter, setProductActiveFilter] = useState<'all' | 'true' | 'false'>('all');
  const [productSearch, setProductSearch] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState<ApiError | null>(null);
  const [productFeedback, setProductFeedback] = useState<string | null>(null);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [confirmArchiveProduct, setConfirmArchiveProduct] = useState<Product | null>(null);

  const [ordersPage, setOrdersPage] = useState<Page<Order> | null>(null);
  const [orderPageNum, setOrderPageNum] = useState(1);
  const [orderStatusFilter, setOrderStatusFilter] = useState<'' | OrderStatus>('');
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [orderError, setOrderError] = useState<ApiError | null>(null);
  const [orderFeedback, setOrderFeedback] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [advancingOrder, setAdvancingOrder] = useState(false);
  const [orderDetailError, setOrderDetailError] = useState<ApiError | null>(null);
  const [orderFormOpen, setOrderFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState<Order | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => undefined);
  }, []);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    setProductError(null);
    try {
      const result = await listAdminProducts({
        page: productPageNum,
        pageSize: 10,
        q: productSearch.trim() || undefined,
        active: productActiveFilter === 'all' ? undefined : productActiveFilter === 'true',
      });
      setProductsPage(result);
    } catch (err) {
      setProductError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to load products.' })
      );
    } finally {
      setLoadingProducts(false);
    }
  }, [productPageNum, productActiveFilter, productSearch]);

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    setOrderError(null);
    try {
      const result = await listAdminOrders({
        page: orderPageNum,
        pageSize: 10,
        status: orderStatusFilter || undefined,
      });
      setOrdersPage(result);
    } catch (err) {
      setOrderError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to load orders.' })
      );
    } finally {
      setLoadingOrders(false);
    }
  }, [orderPageNum, orderStatusFilter]);

  useEffect(() => {
    if (activeTab === 'products') {
      void loadProducts();
    } else {
      void loadOrders();
    }
  }, [activeTab, loadProducts, loadOrders]);

  const handleArchiveProduct = async (product: Product) => {
    setProductError(null);
    setProductFeedback(null);
    setArchivingId(product.id);
    try {
      await archiveAdminProduct(product.id, product.version);
      setProductFeedback(`Archived "${product.name}" (${product.sku}).`);
      await loadProducts();
    } catch (err) {
      setProductError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to archive product.' })
      );
    } finally {
      setArchivingId(null);
    }
  };

  const handleOpenAdminOrder = async (orderId: string) => {
    setOrderDetailError(null);
    try {
      const fresh = await getAdminOrder(orderId);
      setSelectedOrder(fresh);
    } catch (err) {
      setOrderError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to load order.' })
      );
    }
  };

  const handleAdvanceOrderStatus = async (order: Order, nextStatus: 'PROCESSING' | 'SHIPPED') => {
    setAdvancingOrder(true);
    setOrderDetailError(null);
    try {
      const updated = await updateAdminOrderStatus(order.id, {
        status: nextStatus,
        version: order.version,
      });
      setSelectedOrder(updated);
      await loadOrders();
    } catch (err) {
      setOrderDetailError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to update status.' })
      );
    } finally {
      setAdvancingOrder(false);
    }
  };

  const handleDeleteOrder = async (order: Order) => {
    setOrderError(null);
    setOrderFeedback(null);
    setDeletingOrderId(order.id);
    try {
      await deleteAdminOrder(order.id, order.version);
      setOrderFeedback(`Permanently deleted order ${order.id.slice(0, 8)}….`);
      setConfirmDeleteOrder(null);
      await loadOrders();
    } catch (err) {
      setOrderError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to delete order.' })
      );
      setConfirmDeleteOrder(null);
    } finally {
      setDeletingOrderId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E6E4DD] pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#0F4C81]">Operations</p>
          <h1 className="mt-1 text-2xl font-bold text-[#11151C] sm:text-3xl">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-[#555E6D]">
            Manage product inventory and advance paid orders through fulfillment.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Admin sections"
          className="inline-flex rounded-xl border border-[#E6E4DD] bg-[#EFEDE7] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'products'}
            onClick={() => setActiveTab('products')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all cursor-pointer ${
              activeTab === 'products'
                ? 'bg-white text-[#11151C] shadow-xs'
                : 'text-[#555E6D] hover:text-[#11151C]'
            }`}
          >
            <Package className="h-4 w-4" aria-hidden="true" />
            <span>Products</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'orders'}
            onClick={() => setActiveTab('orders')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all cursor-pointer ${
              activeTab === 'orders'
                ? 'bg-white text-[#11151C] shadow-xs'
                : 'text-[#555E6D] hover:text-[#11151C]'
            }`}
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            <span>Orders</span>
          </button>
        </div>
      </div>

      {activeTab === 'products' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="search"
                aria-label="Search admin products"
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setProductPageNum(1);
                }}
                placeholder="Search SKU or name..."
                className="rounded border border-[#CBD2D9] bg-white px-3 py-2 text-sm text-[#161B22] focus:border-[#0F4C81] focus:ring-2 focus:ring-[#0F4C81]/15"
              />
              <select
                aria-label="Filter products by active state"
                value={productActiveFilter}
                onChange={(e) => {
                  setProductActiveFilter(e.target.value as 'all' | 'true' | 'false');
                  setProductPageNum(1);
                }}
                className="rounded border border-[#CBD2D9] bg-white px-3 py-2 text-sm text-[#161B22]"
              >
                <option value="all">All products</option>
                <option value="true">Active only</option>
                <option value="false">Archived only</option>
              </select>
            </div>

            <Button
              variant="primary"
              onClick={() => {
                setEditingProduct(null);
                setProductModalOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add Product</span>
            </Button>
          </div>

          {productFeedback && <Alert tone="success">{productFeedback}</Alert>}

          {productError && (
            <Alert
              tone="error"
              title="Product management error"
              details={productError.details}
              requestId={productError.requestId}
            >
              {productError.message}
            </Alert>
          )}

          {loadingProducts ? (
            <Spinner label="Loading admin products..." />
          ) : !productsPage || productsPage.data.length === 0 ? (
            <EmptyState
              title="No products found"
              description="Add a product or adjust your filters."
            />
          ) : (
            <>
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-[#DDE2E7] text-sm">
                    <thead className="bg-[#ECEFF2] text-left text-xs font-semibold text-[#525C68]">
                      <tr>
                        <th className="px-4 py-3">SKU</th>
                        <th className="px-4 py-3">Product</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3">Price</th>
                        <th className="px-4 py-3">Availability</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DDE2E7] bg-white">
                      {productsPage.data.map((product) => (
                        <tr key={product.id} className="hover:bg-[#F7F8F9]">
                          <td className="px-4 py-3 text-xs text-[#525C68]">{product.sku}</td>
                          <td className="px-4 py-3 font-medium text-[#161B22]">{product.name}</td>
                          <td className="px-4 py-3 text-[#525C68]">{product.category.name}</td>
                          <td className="px-4 py-3 font-semibold text-[#161B22] tabular-nums">
                            {formatMoney(product.price)}
                          </td>
                          <td className="px-4 py-3">
                            <StockBadge
                              availableQuantity={product.availableQuantity}
                              active={product.active}
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingProduct(product);
                                  setProductModalOpen(true);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Edit</span>
                              </Button>
                              {product.active && (
                                <Button
                                  variant="danger"
                                  size="sm"
                                  loading={archivingId === product.id}
                                  onClick={() => setConfirmArchiveProduct(product)}
                                >
                                  <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Archive</span>
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Pagination pagination={productsPage.pagination} onPageChange={setProductPageNum} />
            </>
          )}

          <AdminProductFormModal
            open={productModalOpen}
            onClose={() => setProductModalOpen(false)}
            categories={categories}
            editingProduct={editingProduct}
            onSaved={(saved) => {
              setProductFeedback(
                editingProduct
                  ? `Updated "${saved.name}".`
                  : `Created "${saved.name}" (${saved.sku}).`
              );
              void loadProducts();
            }}
          />

          <ConfirmDialog
            open={Boolean(confirmArchiveProduct)}
            onClose={() => setConfirmArchiveProduct(null)}
            onConfirm={async () => {
              if (!confirmArchiveProduct) return;
              await handleArchiveProduct(confirmArchiveProduct);
              setConfirmArchiveProduct(null);
            }}
            loading={Boolean(confirmArchiveProduct && archivingId === confirmArchiveProduct.id)}
            title="Archive Product?"
            description={
              confirmArchiveProduct
                ? `Are you sure you want to archive "${confirmArchiveProduct.name}" (${confirmArchiveProduct.sku})?`
                : ''
            }
            consequence="This product will be hidden from the public catalog and cannot be added to carts until reactivated."
            confirmLabel="Yes, Archive Product"
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="admin-order-status" className="text-sm font-medium text-[#525C68]">
                Status
              </label>
              <select
                id="admin-order-status"
                value={orderStatusFilter}
                onChange={(e) => {
                  setOrderStatusFilter(e.target.value as '' | OrderStatus);
                  setOrderPageNum(1);
                }}
                className="rounded border border-[#CBD2D9] bg-white px-3 py-1.5 text-sm text-[#161B22]"
              >
                {ADMIN_ORDER_STATUSES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="primary"
              onClick={() => {
                setEditingOrder(null);
                setOrderFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add Order</span>
            </Button>
          </div>

          {orderFeedback && <Alert tone="success">{orderFeedback}</Alert>}

          {orderError && (
            <Alert
              tone="error"
              title="Order management error"
              details={orderError.details}
              requestId={orderError.requestId}
            >
              {orderError.message}
            </Alert>
          )}

          {loadingOrders ? (
            <Spinner label="Loading customer orders..." />
          ) : !ordersPage || ordersPage.data.length === 0 ? (
            <EmptyState
              title="No orders found"
              description="No orders match the selected status filter."
            />
          ) : (
            <>
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-[#DDE2E7] text-sm">
                    <thead className="bg-[#ECEFF2] text-left text-xs font-semibold text-[#525C68]">
                      <tr>
                        <th className="px-4 py-3">Order ID</th>
                        <th className="px-4 py-3">Created</th>
                        <th className="px-4 py-3">Recipient</th>
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
                          <td className="px-4 py-3 text-[#525C68]">
                            {formatInstant(order.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-[#161B22]">
                            {order.shippingAddress.fullName}
                          </td>
                          <td className="px-4 py-3">
                            <OrderStatusBadge status={order.status} />
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-[#161B22] tabular-nums">
                            {formatMoney(order.grandTotal)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleOpenAdminOrder(order.id)}
                              >
                                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Manage</span>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingOrder(order);
                                  setOrderFormOpen(true);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Edit</span>
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                loading={deletingOrderId === order.id}
                                onClick={() => setConfirmDeleteOrder(order)}
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

              <Pagination pagination={ordersPage.pagination} onPageChange={setOrderPageNum} />
            </>
          )}

          <Modal
            open={Boolean(selectedOrder)}
            onClose={() => {
              setSelectedOrder(null);
              setOrderDetailError(null);
            }}
            title="Manage Order"
            maxWidthClass="max-w-2xl"
          >
            <div className="space-y-4">
              {orderDetailError && (
                <Alert
                  tone="error"
                  title="Status update failed"
                  details={orderDetailError.details}
                  requestId={orderDetailError.requestId}
                >
                  {orderDetailError.message}
                </Alert>
              )}
              {selectedOrder && (
                <OrderDetailPanel
                  order={selectedOrder}
                  isAdminView
                  onAdvanceStatus={handleAdvanceOrderStatus}
                  advancingStatus={advancingOrder}
                />
              )}
            </div>
          </Modal>

          <AdminOrderFormModal
            open={orderFormOpen}
            onClose={() => setOrderFormOpen(false)}
            editingOrder={editingOrder}
            products={productsPage?.data ?? []}
            onSaved={(saved) => {
              setOrderFeedback(
                editingOrder
                  ? `Updated order ${saved.id.slice(0, 8)}….`
                  : `Created order ${saved.id.slice(0, 8)}… (${formatMoney(saved.grandTotal)}).`
              );
              void loadOrders();
            }}
          />

          <ConfirmDialog
            open={Boolean(confirmDeleteOrder)}
            onClose={() => setConfirmDeleteOrder(null)}
            onConfirm={async () => {
              if (!confirmDeleteOrder) return;
              await handleDeleteOrder(confirmDeleteOrder);
            }}
            loading={Boolean(confirmDeleteOrder && deletingOrderId === confirmDeleteOrder.id)}
            title="Delete Order Permanently?"
            description={
              confirmDeleteOrder
                ? `Are you sure you want to permanently delete order ${confirmDeleteOrder.id.slice(0, 8)}… (${formatMoney(confirmDeleteOrder.grandTotal)} — ${confirmDeleteOrder.shippingAddress.fullName})?`
                : ''
            }
            consequence="This action cannot be undone. Any active stock reservations for this order will be released back to inventory."
            confirmLabel="Yes, Delete Order"
          />
        </div>
      )}
    </div>
  );
}
