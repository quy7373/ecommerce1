import { apiClient } from '@/lib/apiClient';
import type {
  AdminProductQueryParams,
  Category,
  DataEnvelope,
  Page,
  Product,
  ProductQueryParams,
  ProductWrite,
} from '@/lib/types';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CATEGORIES_TTL_MS = 5 * 60_000;
const CATALOG_TTL_MS = 15_000;

let categoriesCache: CacheEntry<Category[]> | null = null;
let categoriesInFlight: Promise<Category[]> | null = null;

const productsListCache = new Map<string, CacheEntry<Page<Product>>>();
const productDetailCache = new Map<string, CacheEntry<Product>>();
const productDetailInFlight = new Map<string, Promise<Product>>();
let detailChunkPrefetched = false;

export function invalidateCatalogCache(): void {
  productsListCache.clear();
  productDetailCache.clear();
}

function cleanQuery(params: Record<string, unknown>): Record<string, string> {
  const query: Record<string, string> = {};
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    query[key] = String(value);
  }
  return query;
}

export async function listProducts(
  params: ProductQueryParams = {},
  options: { signal?: AbortSignal; bypassCache?: boolean } = {}
): Promise<Page<Product>> {
  const cleaned = cleanQuery(params as Record<string, unknown>);
  const cacheKey = JSON.stringify(cleaned);
  const now = Date.now();

  if (!options.bypassCache) {
    const cached = productsListCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
  }

  const response = await apiClient.get<Page<Product>>('/products', {
    params: cleaned,
    signal: options.signal,
  });

  productsListCache.set(cacheKey, {
    data: response.data,
    expiresAt: Date.now() + CATALOG_TTL_MS,
  });

  // Warm individual product cache from list results for instant detail transitions
  for (const product of response.data.data) {
    productDetailCache.set(product.id, {
      data: product,
      expiresAt: Date.now() + CATALOG_TTL_MS,
    });
  }

  return response.data;
}

export async function getProduct(
  productId: string,
  options: { signal?: AbortSignal; bypassCache?: boolean } = {}
): Promise<Product> {
  const now = Date.now();
  if (!options.bypassCache) {
    const cached = productDetailCache.get(productId);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
    const existing = productDetailInFlight.get(productId);
    if (existing) {
      return existing;
    }
  }

  const req = apiClient
    .get<DataEnvelope<Product>>(`/products/${encodeURIComponent(productId)}`, {
      signal: options.signal,
    })
    .then((response) => {
      productDetailCache.set(productId, {
        data: response.data.data,
        expiresAt: Date.now() + CATALOG_TTL_MS,
      });
      return response.data.data;
    })
    .finally(() => {
      productDetailInFlight.delete(productId);
    });

  if (!options.signal) {
    productDetailInFlight.set(productId, req);
  }
  return req;
}

export function prefetchProduct(productId: string): void {
  if (!detailChunkPrefetched) {
    detailChunkPrefetched = true;
    void import('@/pages/ProductDetailPage').catch(() => {
      detailChunkPrefetched = false;
    });
  }
  const cached = productDetailCache.get(productId);
  if (cached && cached.expiresAt > Date.now()) return;
  if (productDetailInFlight.has(productId)) return;
  void getProduct(productId).catch(() => undefined);
}

export async function listCategories(options: { bypassCache?: boolean } = {}): Promise<Category[]> {
  const now = Date.now();
  if (!options.bypassCache && categoriesCache && categoriesCache.expiresAt > now) {
    return categoriesCache.data;
  }
  if (!options.bypassCache && categoriesInFlight) {
    return categoriesInFlight;
  }

  categoriesInFlight = apiClient
    .get<DataEnvelope<Category[]>>('/categories')
    .then((response) => {
      categoriesCache = {
        data: response.data.data,
        expiresAt: Date.now() + CATEGORIES_TTL_MS,
      };
      return response.data.data;
    })
    .finally(() => {
      categoriesInFlight = null;
    });

  return categoriesInFlight;
}

export async function listAdminProducts(params: AdminProductQueryParams = {}): Promise<Page<Product>> {
  const response = await apiClient.get<Page<Product>>('/admin/products', {
    params: cleanQuery(params as Record<string, unknown>),
  });
  return response.data;
}

export async function getAdminProduct(productId: string): Promise<Product> {
  const response = await apiClient.get<DataEnvelope<Product>>(
    `/admin/products/${encodeURIComponent(productId)}`
  );
  return response.data.data;
}

export async function createAdminProduct(payload: ProductWrite): Promise<Product> {
  const response = await apiClient.post<DataEnvelope<Product>>('/admin/products', payload);
  invalidateCatalogCache();
  return response.data.data;
}

export async function updateAdminProduct(
  productId: string,
  payload: Partial<ProductWrite> & { version: number }
): Promise<Product> {
  const response = await apiClient.patch<DataEnvelope<Product>>(
    `/admin/products/${encodeURIComponent(productId)}`,
    payload
  );
  invalidateCatalogCache();
  return response.data.data;
}

export async function archiveAdminProduct(productId: string, version: number): Promise<void> {
  await apiClient.delete(`/admin/products/${encodeURIComponent(productId)}`, {
    data: { version },
  });
  invalidateCatalogCache();
}
