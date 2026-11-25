import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/lib/apiClient';
import { formatMoney } from '@/lib/money';
import { isValidEmailAddress, validateShippingAddress } from '@/lib/validation';
import type { Order, OrderStatus, Product } from '@/lib/types';
import {
  ShippingAddressForm,
  type ShippingFormValues,
} from '@/features/checkout/ShippingAddressForm';
import { createAdminOrder, updateAdminOrder } from './ordersApi';

interface AdminOrderFormModalProps {
  open: boolean;
  onClose: () => void;
  editingOrder: Order | null;
  products: Product[];
  onSaved: (order: Order) => void;
}

const ALL_STATUSES: { value: OrderStatus; label: string }[] = [
  { value: 'PENDING_PAYMENT', label: 'Pending Payment' },
  { value: 'PAID', label: 'Paid' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'SHIPPED', label: 'Shipped' },
  { value: 'PAYMENT_REVIEW', label: 'Payment Review' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
];

const EMPTY_ADDRESS: ShippingFormValues = {
  fullName: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  phone: '',
};

interface DraftItem {
  productId: string;
  quantity: number;
}

export function AdminOrderFormModal({
  open,
  onClose,
  editingOrder,
  products,
  onSaved,
}: AdminOrderFormModalProps) {
  const activeProducts = products.filter((p) => p.active && p.availableQuantity > 0);
  const [customerEmail, setCustomerEmail] = useState('');
  const [status, setStatus] = useState<OrderStatus>('PENDING_PAYMENT');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [address, setAddress] = useState<ShippingFormValues>(EMPTY_ADDRESS);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setApiError(null);
    if (editingOrder) {
      setStatus(editingOrder.status);
      setAddress({
        fullName: editingOrder.shippingAddress.fullName || '',
        line1: editingOrder.shippingAddress.line1 || '',
        line2: editingOrder.shippingAddress.line2 || '',
        city: editingOrder.shippingAddress.city || '',
        region: editingOrder.shippingAddress.region || '',
        postalCode: editingOrder.shippingAddress.postalCode || '',
        phone: editingOrder.shippingAddress.phone || '',
      });
    } else {
      setCustomerEmail('');
      setStatus('PENDING_PAYMENT');
      setAddress(EMPTY_ADDRESS);
      setItems(
        activeProducts.length > 0 ? [{ productId: activeProducts[0].id, quantity: 1 }] : []
      );
    }
  }, [open, editingOrder]);

  const handleAddressChange = (field: keyof ShippingFormValues, value: string) => {
    setAddress((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const copy = { ...prev };
      delete copy[field];
      return copy;
    });
  };

  const estimatedTotal = items.reduce((sum, line) => {
    const prod = products.find((p) => p.id === line.productId);
    return sum + (prod ? prod.price * line.quantity : 0);
  }, 0);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const addrValidation = validateShippingAddress(address);
    const nextErrors: Record<string, string> = { ...addrValidation.errors };

    if (!editingOrder) {
      if (customerEmail.trim() && !isValidEmailAddress(customerEmail)) {
        nextErrors.customerEmail = 'Enter a valid registered customer email or leave blank.';
      }
      if (items.length === 0 || items.some((i) => !i.productId || i.quantity < 1 || i.quantity > 99)) {
        nextErrors.items = 'Add at least one product with quantity between 1 and 99.';
      }
    }

    if (Object.keys(nextErrors).length > 0 || !addrValidation.normalized) {
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const saved = editingOrder
        ? await updateAdminOrder(editingOrder.id, {
            status,
            shippingAddress: addrValidation.normalized,
            version: editingOrder.version,
          })
        : await createAdminOrder({
            ...(customerEmail.trim() ? { customerEmail: customerEmail.trim() } : {}),
            items,
            shippingAddress: addrValidation.normalized,
          });
      onSaved(saved);
      onClose();
    } catch (err) {
      setApiError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to save order.' })
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingOrder ? `Edit Order (${editingOrder.id.slice(0, 8)}…)` : 'Add Order'}
      maxWidthClass="max-w-2xl"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {apiError && (
          <Alert
            tone="error"
            title="Could not save order"
            details={apiError.details}
            requestId={apiError.requestId}
          >
            {apiError.message}
          </Alert>
        )}

        {editingOrder ? (
          <div className="space-y-1.5">
            <label htmlFor="admin-edit-order-status" className="block text-sm font-medium text-[#11151C]">
              Order Status
            </label>
            <select
              id="admin-edit-order-status"
              value={status}
              disabled={submitting}
              onChange={(e) => setStatus(e.target.value as OrderStatus)}
              className="block w-full rounded-lg border border-[#D8D5CC] bg-white px-3.5 py-2.5 text-sm text-[#11151C] focus:border-[#0F4C81] focus:ring-3 focus:ring-[#0F4C81]/15"
            >
              {ALL_STATUSES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-[#555E6D]">
              Changing a Pending Payment order to Cancelled or Expired automatically releases reserved stock.
            </p>
          </div>
        ) : (
          <>
            <Input
              id="admin-order-customer-email"
              label="Customer Email (Optional)"
              type="email"
              placeholder="Leave blank to assign to your admin account"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              error={fieldErrors.customerEmail}
              disabled={submitting}
            />

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-[#11151C]">Order Items</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting || activeProducts.length === 0}
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      { productId: activeProducts[0]?.id || '', quantity: 1 },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Item</span>
                </Button>
              </div>

              {activeProducts.length === 0 ? (
                <Alert tone="warning">
                  No active in-stock products available. Add or restock a product first.
                </Alert>
              ) : (
                <div className="space-y-2">
                  {items.map((line, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                      <select
                        aria-label={`Product for item ${idx + 1}`}
                        value={line.productId}
                        disabled={submitting}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, productId: e.target.value } : item
                            )
                          )
                        }
                        className="flex-1 min-w-0 rounded-lg border border-[#D8D5CC] bg-white px-3 py-2 text-sm text-[#11151C]"
                      >
                        {activeProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({formatMoney(p.price)} · {p.availableQuantity} in stock)
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        aria-label={`Quantity for item ${idx + 1}`}
                        min={1}
                        max={99}
                        disabled={submitting}
                        value={line.quantity}
                        onChange={(e) => {
                          const next = Math.max(1, Math.min(99, Number(e.target.value) || 1));
                          setItems((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, quantity: next } : item))
                          );
                        }}
                        className="w-20 rounded-lg border border-[#D8D5CC] bg-white px-2.5 py-2 text-sm text-[#11151C] tabular-nums"
                      />

                      {items.length > 1 && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label={`Remove item ${idx + 1}`}
                          className="rounded-lg p-2 text-[#6B7684] hover:bg-[#FEF3F2] hover:text-[#B42318] cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                  <p className="text-right text-xs font-semibold text-[#11151C] tabular-nums">
                    Estimated Total: {formatMoney(estimatedTotal)}
                  </p>
                </div>
              )}

              {fieldErrors.items && (
                <p role="alert" className="text-xs font-medium text-[#B42318]">
                  {fieldErrors.items}
                </p>
              )}
            </div>
          </>
        )}

        <div className="border-t border-[#EFEDE7] pt-4">
          <h3 className="text-sm font-semibold text-[#11151C] mb-3">Shipping Address</h3>
          <ShippingAddressForm
            values={address}
            errors={fieldErrors}
            disabled={submitting}
            onChange={handleAddressChange}
          />
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#EFEDE7] pt-4">
          <Button variant="outline" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            {editingOrder ? 'Save Changes' : 'Create Order'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
