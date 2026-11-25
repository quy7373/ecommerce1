import { useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/apiClient';
import { centsToDollarInput, parseDollarsToCents } from '@/lib/money';
import { validateProductWrite } from '@/lib/validation';
import type { Category, Product, ProductWrite } from '@/lib/types';
import { createAdminProduct, updateAdminProduct } from './productsApi';

interface AdminProductFormModalProps {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  editingProduct: Product | null;
  onSaved: (product: Product) => void;
}

export function AdminProductFormModal({
  open,
  onClose,
  categories,
  editingProduct,
  onSaved,
}: AdminProductFormModalProps) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [stockOnHand, setStockOnHand] = useState('0');
  const [active, setActive] = useState(true);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setApiError(null);

    if (editingProduct) {
      setSku(editingProduct.sku);
      setName(editingProduct.name);
      setDescription(editingProduct.description);
      setCategoryId(editingProduct.category.id);
      setPriceInput(centsToDollarInput(editingProduct.price));
      setImageUrl(editingProduct.imageUrl || '');
      setStockOnHand(String(editingProduct.availableQuantity));
      setActive(editingProduct.active);
    } else {
      setSku('');
      setName('');
      setDescription('');
      setCategoryId(categories[0]?.id || '');
      setPriceInput('');
      setImageUrl('');
      setStockOnHand('10');
      setActive(true);
    }
  }, [open, editingProduct, categories]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const priceCents = parseDollarsToCents(priceInput);
    const validation = validateProductWrite({
      sku,
      name,
      description,
      categoryId,
      priceCents,
      imageUrl,
      stockOnHand,
      active,
    });

    if (!validation.valid || !validation.normalized) {
      setFieldErrors(validation.errors);
      return;
    }

    setFieldErrors({});
    setSaving(true);
    try {
      let saved: Product;
      if (editingProduct) {
        const patch: Partial<ProductWrite> & { version: number } = {
          version: editingProduct.version,
          sku: validation.normalized.sku,
          name: validation.normalized.name,
          description: validation.normalized.description,
          categoryId: validation.normalized.categoryId,
          price: validation.normalized.price,
          imageUrl: validation.normalized.imageUrl,
          stockOnHand: validation.normalized.stockOnHand,
          active: validation.normalized.active,
        };
        saved = await updateAdminProduct(editingProduct.id, patch);
      } else {
        saved = await createAdminProduct(validation.normalized);
      }
      onSaved(saved);
      onClose();
    } catch (err) {
      const normalized =
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to save product.' });
      setApiError(normalized);

      if (normalized.code === 'VALIDATION_ERROR' && normalized.details.length > 0) {
        const mapped: Record<string, string> = {};
        for (const d of normalized.details) {
          mapped[d.field] = d.message;
        }
        setFieldErrors(mapped);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingProduct ? `Edit Product — ${editingProduct.sku}` : 'Create New Product'}
      maxWidthClass="max-w-xl"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {apiError && (
          <Alert
            tone="error"
            title="Could not save product"
            details={apiError.details}
            requestId={apiError.requestId}
          >
            {apiError.message}
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="admin-product-sku"
            label="SKU"
            required
            maxLength={64}
            value={sku}
            error={fieldErrors.sku}
            hint="Uppercase A-Z, 0-9, _, -"
            onChange={(e) => setSku(e.target.value.toUpperCase())}
            placeholder="KB-MECH-001"
          />

          <Select
            id="admin-product-category"
            label="Category"
            required
            value={categoryId}
            error={fieldErrors.categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Select category...</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </Select>
        </div>

        <Input
          id="admin-product-name"
          label="Product Name"
          required
          maxLength={200}
          value={name}
          error={fieldErrors.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Mechanical Keyboard"
        />

        <div className="space-y-1">
          <label
            htmlFor="admin-product-description"
            className="block text-sm font-medium text-[#161B22]"
          >
            Description
          </label>
          <textarea
            id="admin-product-description"
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Plain-text product description..."
            className="block w-full rounded border border-[#CBD2D9] bg-white px-3 py-2 text-sm text-[#161B22] focus:border-[#0F4C81] focus:ring-2 focus:ring-[#0F4C81]/15"
          />
          {fieldErrors.description && (
            <p role="alert" className="text-xs font-medium text-[#B42318]">
              {fieldErrors.description}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="admin-product-price"
            label="Price (USD)"
            required
            inputMode="decimal"
            value={priceInput}
            error={fieldErrors.price}
            hint="Stored as integer cents"
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="79.99"
          />

          <Input
            id="admin-product-stock"
            label="Stock On Hand"
            required
            inputMode="numeric"
            value={stockOnHand}
            error={fieldErrors.stockOnHand}
            hint="Must be >= reserved units"
            onChange={(e) => setStockOnHand(e.target.value)}
            placeholder="25"
          />
        </div>

        <Input
          id="admin-product-imageUrl"
          label="Image URL (Optional HTTPS)"
          type="url"
          maxLength={2048}
          value={imageUrl}
          error={fieldErrors.imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://cdn.example.com/images/product.jpg"
        />

        <label className="inline-flex items-center gap-2 text-sm font-medium text-[#161B22] cursor-pointer">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-[#CBD2D9] text-[#0F4C81] focus:ring-[#0F4C81]"
          />
          <span>Active (visible in public catalog)</span>
        </label>

        <div className="flex justify-end gap-3 border-t border-[#DDE2E7] pt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {editingProduct ? 'Save Changes' : 'Create Product'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
