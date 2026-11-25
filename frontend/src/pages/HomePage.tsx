import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, RotateCcw, ShieldCheck, PackageCheck, SlidersHorizontal } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ApiError } from '@/lib/apiClient';
import { parseDollarsToCents } from '@/lib/money';
import type { Category, Page, Product, ProductSort } from '@/lib/types';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/features/auth/AuthContext';
import { useCart } from '@/features/cart/CartContext';
import { listCategories, listProducts } from '@/features/products/productsApi';
import { ProductCard } from '@/features/products/ProductCard';
import { Pagination } from '@/features/products/Pagination';

function CatalogSkeletonGrid() {
  return (
    <div
      role="status"
      aria-label="Loading product catalog..."
      className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {Array.from({ length: 8 }).map((_, idx) => (
        <div
          key={idx}
          className="flex flex-col overflow-hidden rounded-2xl border border-[#E6E4DD] bg-white animate-pulse"
        >
          <div className="aspect-[4/3] w-full bg-[#EFEDE7]" />
          <div className="flex flex-1 flex-col p-5 space-y-3">
            <div className="flex justify-between gap-2">
              <div className="h-3 w-20 rounded bg-[#EFEDE7]" />
              <div className="h-3 w-24 rounded bg-[#EFEDE7]" />
            </div>
            <div className="h-5 w-3/4 rounded bg-[#E6E4DD]" />
            <div className="space-y-1.5">
              <div className="h-3.5 w-full rounded bg-[#EFEDE7]" />
              <div className="h-3.5 w-5/6 rounded bg-[#EFEDE7]" />
            </div>
            <div className="mt-auto flex items-center justify-between border-t border-[#F0EEE8] pt-4">
              <div className="h-6 w-20 rounded bg-[#E6E4DD]" />
              <div className="h-8 w-20 rounded-xl bg-[#EFEDE7]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const SORT_OPTIONS: { value: ProductSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'name_asc', label: 'Name: A to Z' },
];

export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { addItem } = useCart();

  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const debouncedSearch = useDebounce(searchInput.trim(), 300);

  const [categoryId, setCategoryId] = useState(() => searchParams.get('categoryId') || '');
  const [minPriceInput, setMinPriceInput] = useState(() => searchParams.get('minPrice') || '');
  const [maxPriceInput, setMaxPriceInput] = useState(() => searchParams.get('maxPrice') || '');
  const [inStockOnly, setInStockOnly] = useState(() => searchParams.get('inStock') === 'true');
  const [sort, setSort] = useState<ProductSort>(
    () => (searchParams.get('sort') as ProductSort) || 'newest'
  );
  const [page, setPage] = useState(() => {
    const raw = Number(searchParams.get('page'));
    return Number.isInteger(raw) && raw >= 1 ? raw : 1;
  });

  const [categories, setCategories] = useState<Category[]>([]);
  const [catalogPage, setCatalogPage] = useState<Page<Product> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [priceRangeError, setPriceRangeError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(() => {
        // Categories filter gracefully stays at "All categories"
      });
  }, []);

  const loadProducts = useCallback(
    async (signal?: AbortSignal) => {
      const minCents = minPriceInput.trim() ? parseDollarsToCents(minPriceInput) : undefined;
      const maxCents = maxPriceInput.trim() ? parseDollarsToCents(maxPriceInput) : undefined;

      if (minPriceInput.trim() && minCents === null) {
        setPriceRangeError('Minimum price must be a valid non-negative USD amount (for example, 10.00).');
        return;
      }
      if (maxPriceInput.trim() && maxCents === null) {
        setPriceRangeError('Maximum price must be a valid non-negative USD amount (for example, 100.00).');
        return;
      }
      if (
        minCents !== undefined &&
        minCents !== null &&
        maxCents !== undefined &&
        maxCents !== null &&
        minCents > maxCents
      ) {
        setPriceRangeError('Minimum price cannot exceed maximum price.');
        return;
      }

      setPriceRangeError(null);
      setLoading(true);
      setError(null);

      try {
        const result = await listProducts(
          {
            q: debouncedSearch || undefined,
            categoryId: categoryId || undefined,
            minPrice: minCents ?? undefined,
            maxPrice: maxCents ?? undefined,
            inStock: inStockOnly ? true : undefined,
            sort,
            page,
            pageSize: 12,
          },
          { signal }
        );
        if (!signal?.aborted) {
          setCatalogPage(result);
        }
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiError
            ? err
            : new ApiError({ status: 0, code: 'UNKNOWN_ERROR', message: 'Failed to load catalog.' })
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [debouncedSearch, categoryId, minPriceInput, maxPriceInput, inStockOnly, sort, page]
  );

  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (debouncedSearch) nextParams.set('q', debouncedSearch);
    if (categoryId) nextParams.set('categoryId', categoryId);
    if (minPriceInput.trim()) nextParams.set('minPrice', minPriceInput.trim());
    if (maxPriceInput.trim()) nextParams.set('maxPrice', maxPriceInput.trim());
    if (inStockOnly) nextParams.set('inStock', 'true');
    if (sort !== 'newest') nextParams.set('sort', sort);
    if (page > 1) nextParams.set('page', String(page));
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [debouncedSearch, categoryId, minPriceInput, maxPriceInput, inStockOnly, sort, page, searchParams, setSearchParams]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProducts(controller.signal);
    return () => controller.abort();
  }, [loadProducts]);

  const handleResetFilters = () => {
    setSearchInput('');
    setCategoryId('');
    setMinPriceInput('');
    setMaxPriceInput('');
    setInStockOnly(false);
    setSort('newest');
    setPage(1);
    setPriceRangeError(null);
  };

  const handleQuickAdd = useCallback(
    async (product: Product) => {
      setFeedback(null);
      if (!isAuthenticated) {
        navigate('/login', { state: { from: `/products/${product.id}` } });
        return;
      }

      setAddingIds((prev) => new Set(prev).add(product.id));
      try {
        await addItem(product.id, 1);
        setFeedback({ tone: 'success', text: `Added "${product.name}" to your cart.` });
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : null;
        setFeedback({
          tone: 'error',
          text: apiErr ? apiErr.message : 'Unable to add item to cart.',
        });
      } finally {
        setAddingIds((prev) => {
          const next = new Set(prev);
          next.delete(product.id);
          return next;
        });
      }
    },
    [isAuthenticated, navigate, addItem]
  );

  const totalCount = catalogPage?.pagination.totalItems;
  const hasActiveFilters = Boolean(
    searchInput || categoryId || minPriceInput || maxPriceInput || inStockOnly || sort !== 'newest'
  );

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-[#E6E4DD] bg-white bg-hero-grid p-6 sm:p-8 lg:p-10 shadow-[0_2px_10px_rgba(17,21,28,0.04)]">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7 space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#D4E3F1] bg-[#EDF4FA] px-3 py-1 text-xs font-semibold text-[#0F4C81]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0F4C81]" aria-hidden="true" />
              <span>Kanto Studio · Curated Desk &amp; Carry Goods</span>
            </div>

            <h1 className="text-3xl font-bold tracking-tight text-[#11151C] sm:text-5xl leading-[1.06]">
              Precision tools for focused work.
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-[#555E6D]">
              Workspace hardware and desk goods engineered for daily craft — with live stock counts,
              exact USD pricing, and hosted Stripe checkout.
            </p>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1 text-xs font-medium text-[#555E6D]">
              <span className="inline-flex items-center gap-1.5">
                <PackageCheck className="h-4 w-4 text-[#157347]" aria-hidden="true" />
                Live inventory reservation
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-[#0F4C81]" aria-hidden="true" />
                Hosted Stripe checkout
              </span>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-[#E6E4DD] bg-[#FAF9F6]/95 p-5 shadow-xs space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#555E6D]">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-[#0F4C81]" aria-hidden="true" />
                  Filter Catalog
                </span>
                {hasActiveFilters && (
                  <span className="rounded-full bg-[#EDF4FA] px-2 py-0.5 text-[11px] font-medium text-[#0F4C81]">
                    Active
                  </span>
                )}
              </div>

              <div>
                <label
                  htmlFor="catalog-search"
                  className="block text-xs font-medium text-[#11151C] mb-1"
                >
                  Search (name, description, SKU)
                </label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7684]"
                    aria-hidden="true"
                  />
                  <input
                    id="catalog-search"
                    type="search"
                    maxLength={100}
                    value={searchInput}
                    onChange={(e) => {
                      setSearchInput(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Keyboard, headphones, SKU..."
                    className="block w-full rounded-lg border border-[#D8D5CC] bg-white py-2 pl-9 pr-3 text-sm text-[#11151C] placeholder:text-[#8C96A2] transition-all focus:border-[#0F4C81] focus:ring-3 focus:ring-[#0F4C81]/15"
                  />
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="catalog-category"
                    className="block text-xs font-medium text-[#11151C] mb-1"
                  >
                    Category
                  </label>
                  <select
                    id="catalog-category"
                    value={categoryId}
                    onChange={(e) => {
                      setCategoryId(e.target.value);
                      setPage(1);
                    }}
                    className="block w-full rounded-lg border border-[#D8D5CC] bg-white px-2.5 py-2 text-sm text-[#11151C] focus:border-[#0F4C81] focus:ring-3 focus:ring-[#0F4C81]/15"
                  >
                    <option value="">All categories</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="catalog-sort"
                    className="block text-xs font-medium text-[#11151C] mb-1"
                  >
                    Sort by
                  </label>
                  <select
                    id="catalog-sort"
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value as ProductSort);
                      setPage(1);
                    }}
                    className="block w-full rounded-lg border border-[#D8D5CC] bg-white px-2.5 py-2 text-sm text-[#11151C] focus:border-[#0F4C81] focus:ring-3 focus:ring-[#0F4C81]/15"
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="catalog-min-price"
                    className="block text-xs font-medium text-[#11151C] mb-1"
                  >
                    Min price ($)
                  </label>
                  <input
                    id="catalog-min-price"
                    type="text"
                    inputMode="decimal"
                    value={minPriceInput}
                    onChange={(e) => {
                      setMinPriceInput(e.target.value);
                      setPage(1);
                    }}
                    placeholder="0.00"
                    className="block w-full rounded-lg border border-[#D8D5CC] bg-white px-2.5 py-1.5 text-sm text-[#11151C] tabular-nums focus:border-[#0F4C81] focus:ring-3 focus:ring-[#0F4C81]/15"
                  />
                </div>

                <div>
                  <label
                    htmlFor="catalog-max-price"
                    className="block text-xs font-medium text-[#11151C] mb-1"
                  >
                    Max price ($)
                  </label>
                  <input
                    id="catalog-max-price"
                    type="text"
                    inputMode="decimal"
                    value={maxPriceInput}
                    onChange={(e) => {
                      setMaxPriceInput(e.target.value);
                      setPage(1);
                    }}
                    placeholder="500.00"
                    className="block w-full rounded-lg border border-[#D8D5CC] bg-white px-2.5 py-1.5 text-sm text-[#11151C] tabular-nums focus:border-[#0F4C81] focus:ring-3 focus:ring-[#0F4C81]/15"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-[#11151C] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inStockOnly}
                    onChange={(e) => {
                      setInStockOnly(e.target.checked);
                      setPage(1);
                    }}
                    className="h-4 w-4 rounded border-[#D8D5CC] text-[#0F4C81] focus:ring-[#0F4C81]"
                  />
                  <span>In stock only</span>
                </label>

                <Button variant="ghost" size="sm" onClick={handleResetFilters}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Reset Filters</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {categories.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick category filter">
            <button
              type="button"
              onClick={() => {
                setCategoryId('');
                setPage(1);
              }}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                categoryId === ''
                  ? 'bg-[#11151C] text-white shadow-xs'
                  : 'border border-[#E6E4DD] bg-white text-[#555E6D] hover:border-[#CBC7BC] hover:text-[#11151C]'
              }`}
            >
              All Goods
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setCategoryId(cat.id);
                  setPage(1);
                }}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                  categoryId === cat.id
                    ? 'bg-[#11151C] text-white shadow-xs'
                    : 'border border-[#E6E4DD] bg-white text-[#555E6D] hover:border-[#CBC7BC] hover:text-[#11151C]'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {!loading && totalCount !== undefined && totalCount > 0 && (
            <p className="text-xs font-medium text-[#555E6D] tabular-nums">
              Showing {catalogPage?.data.length} of {totalCount} items
            </p>
          )}
        </div>
      )}

      {priceRangeError && <Alert tone="error">{priceRangeError}</Alert>}

      {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

      {error && (
        <Alert
          tone="error"
          title="Could not load catalog"
          details={error.details}
          requestId={error.requestId}
        >
          {error.message}
        </Alert>
      )}

      {loading && !catalogPage ? (
        <CatalogSkeletonGrid />
      ) : !catalogPage || catalogPage.data.length === 0 ? (
        <EmptyState
          title="No matching products"
          description="Adjust your search term, category, or price range to view available items."
          action={
            <Button variant="outline" onClick={handleResetFilters}>
              Clear all filters
            </Button>
          }
        />
      ) : (
        <>
          <div
            className={`grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 transition-opacity duration-150 ${
              loading ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {catalogPage.data.map((product, idx) => (
              <ProductCard
                key={product.id}
                product={product}
                onAddToCart={handleQuickAdd}
                adding={addingIds.has(product.id)}
                priority={idx < 4}
              />
            ))}
          </div>

          <Pagination pagination={catalogPage.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
