import type { Page, Route } from '@playwright/test';

export interface MockState {
  role: 'GUEST' | 'CUSTOMER' | 'ADMIN';
  csrfToken: string;
  categories: Array<{ id: string; name: string; slug: string }>;
  products: Array<{
    id: string;
    sku: string;
    name: string;
    description: string;
    category: { id: string; name: string; slug: string };
    price: number;
    currency: 'USD';
    imageUrl: string | null;
    availableQuantity: number;
    active: boolean;
    version: number;
  }>;
  cart: {
    id: string;
    version: number;
    items: Array<{ productId: string; quantity: number }>;
  };
  orders: Array<{
    id: string;
    status:
      | 'PENDING_PAYMENT'
      | 'PAID'
      | 'PROCESSING'
      | 'SHIPPED'
      | 'CANCELLED'
      | 'EXPIRED'
      | 'PAYMENT_REVIEW';
    items: Array<{
      productId: string;
      sku: string;
      name: string;
      unitPrice: number;
      quantity: number;
      lineTotal: number;
    }>;
    shippingAddress: {
      fullName: string;
      line1: string;
      line2?: string;
      city: string;
      region: string;
      postalCode: string;
      country: 'US';
      phone?: string;
    };
    subtotal: number;
    shippingTotal: number;
    taxTotal: number;
    grandTotal: number;
    currency: 'USD';
    createdAt: string;
    updatedAt: string;
    reservationExpiresAt: string;
    paidAt: string | null;
    cancellationRequestedAt: string | null;
    version: number;
  }>;
  lastOrderIdempotencyKey: string | null;
  lastCheckoutIdempotencyKey: string | null;
  lastCsrfHeader: string | null;
}

export function createInitialMockState(role: 'GUEST' | 'CUSTOMER' | 'ADMIN' = 'GUEST'): MockState {
  const catElectronics = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Electronics',
    slug: 'electronics',
  };
  const catAccessories = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Accessories',
    slug: 'accessories',
  };

  return {
    role,
    csrfToken: 'test-csrf-token-base64url-32bytes',
    categories: [catAccessories, catElectronics],
    products: [
      {
        id: 'aaaa1111-1111-4111-8111-111111111111',
        sku: 'KB-MECH-001',
        name: 'Tactile Mechanical Keyboard',
        description: 'Compact 75% hot-swappable mechanical keyboard with aluminum frame.',
        category: catElectronics,
        price: 12900,
        currency: 'USD',
        imageUrl: null,
        availableQuantity: 15,
        active: true,
        version: 1,
      },
      {
        id: 'aaaa2222-2222-4222-8222-222222222222',
        sku: 'MS-ERGO-002',
        name: 'Wireless Ergonomic Mouse',
        description: 'Low-latency wireless mouse sculpted for all-day comfort.',
        category: catElectronics,
        price: 6900,
        currency: 'USD',
        imageUrl: null,
        availableQuantity: 3,
        active: true,
        version: 1,
      },
      {
        id: 'aaaa3333-3333-4333-8333-333333333333',
        sku: 'MAT-DESK-003',
        name: 'Wool Felt Desk Mat',
        description: 'Minimalist acoustic felt desk pad for clean workspaces.',
        category: catAccessories,
        price: 3500,
        currency: 'USD',
        imageUrl: null,
        availableQuantity: 0,
        active: true,
        version: 1,
      },
    ],
    cart: {
      id: 'cccc1111-1111-4111-8111-111111111111',
      version: 1,
      items: [],
    },
    orders: [
      {
        id: 'dddd1111-1111-4111-8111-111111111111',
        status: 'PAID',
        items: [
          {
            productId: 'aaaa1111-1111-4111-8111-111111111111',
            sku: 'KB-MECH-001',
            name: 'Tactile Mechanical Keyboard',
            unitPrice: 12900,
            quantity: 1,
            lineTotal: 12900,
          },
        ],
        shippingAddress: {
          fullName: 'Alex Rivera',
          line1: '123 Market St',
          city: 'San Francisco',
          region: 'CA',
          postalCode: '94107',
          country: 'US',
        },
        subtotal: 12900,
        shippingTotal: 0,
        taxTotal: 0,
        grandTotal: 12900,
        currency: 'USD',
        createdAt: '2026-11-22T12:00:00Z',
        updatedAt: '2026-11-22T12:05:00Z',
        reservationExpiresAt: '2026-11-22T12:30:00Z',
        paidAt: '2026-11-22T12:05:00Z',
        cancellationRequestedAt: null,
        version: 2,
      },
      {
        id: 'dddd2222-2222-4222-8222-222222222222',
        status: 'PENDING_PAYMENT',
        items: [
          {
            productId: 'aaaa2222-2222-4222-8222-222222222222',
            sku: 'MS-ERGO-002',
            name: 'Wireless Ergonomic Mouse',
            unitPrice: 6900,
            quantity: 1,
            lineTotal: 6900,
          },
        ],
        shippingAddress: {
          fullName: 'Alex Rivera',
          line1: '123 Market St',
          city: 'San Francisco',
          region: 'CA',
          postalCode: '94107',
          country: 'US',
        },
        subtotal: 6900,
        shippingTotal: 0,
        taxTotal: 0,
        grandTotal: 6900,
        currency: 'USD',
        createdAt: '2026-11-23T08:00:00Z',
        updatedAt: '2026-11-23T08:00:00Z',
        reservationExpiresAt: '2026-11-23T08:30:00Z',
        paidAt: null,
        cancellationRequestedAt: null,
        version: 1,
      },
    ],
    lastOrderIdempotencyKey: null,
    lastCheckoutIdempotencyKey: null,
    lastCsrfHeader: null,
  };
}

function jsonError(route: Route, status: number, code: string, message: string) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({
      error: {
        code,
        message,
        details: [],
        requestId: '99999999-9999-4999-8999-999999999999',
      },
    }),
  });
}

function buildCartResponse(state: MockState) {
  const items = state.cart.items
    .map((entry) => {
      const product = state.products.find((p) => p.id === entry.productId);
      if (!product) return null;
      return {
        product,
        quantity: entry.quantity,
        lineTotal: product.price * entry.quantity,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  return {
    id: state.cart.id,
    version: state.cart.version,
    items,
    subtotal,
    shippingTotal: 0,
    taxTotal: 0,
    grandTotal: subtotal,
    currency: 'USD' as const,
  };
}

export async function installMockApi(page: Page, state: MockState) {
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = req.method().toUpperCase();

    const requireAuth = () => state.role !== 'GUEST';
    const requireAdmin = () => state.role === 'ADMIN';
    const checkCsrf = () => {
      const token = req.headers()['x-csrf-token'] || null;
      state.lastCsrfHeader = token;
      return token === state.csrfToken;
    };

    // 1. Auth
    if (method === 'GET' && path === '/auth/session') {
      if (!requireAuth()) {
        return jsonError(route, 401, 'UNAUTHENTICATED', 'Authentication required.');
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: state.role === 'ADMIN' ? 'admin-uuid-1' : 'cust-uuid-1',
            email: state.role === 'ADMIN' ? 'admin@storefront.test' : 'alex@storefront.test',
            displayName: state.role === 'ADMIN' ? 'Store Admin' : 'Alex Rivera',
            role: state.role,
          },
          csrfToken: state.csrfToken,
          expiresAt: '2026-11-23T12:00:00Z',
        }),
      });
    }

    if (method === 'POST' && path === '/auth/logout') {
      if (!requireAuth()) return jsonError(route, 401, 'UNAUTHENTICATED', 'Not signed in.');
      if (!checkCsrf()) return jsonError(route, 403, 'CSRF_INVALID', 'Invalid CSRF token.');
      state.role = 'GUEST';
      return route.fulfill({ status: 204, body: '' });
    }

    // 2. Categories
    if (method === 'GET' && path === '/categories') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: state.categories }),
      });
    }

    // 3. Public Products
    if (method === 'GET' && path === '/products') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const catId = url.searchParams.get('categoryId') || '';
      const minPrice = url.searchParams.get('minPrice') ? Number(url.searchParams.get('minPrice')) : null;
      const maxPrice = url.searchParams.get('maxPrice') ? Number(url.searchParams.get('maxPrice')) : null;
      const inStock = url.searchParams.get('inStock') === 'true';
      const sort = url.searchParams.get('sort') || 'newest';
      const pageNum = Number(url.searchParams.get('page') || '1');
      const pageSize = Number(url.searchParams.get('pageSize') || '20');

      let list = state.products.filter((p) => p.active);
      if (q) {
        list = list.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q)
        );
      }
      if (catId) list = list.filter((p) => p.category.id === catId);
      if (minPrice !== null) list = list.filter((p) => p.price >= minPrice);
      if (maxPrice !== null) list = list.filter((p) => p.price <= maxPrice);
      if (inStock) list = list.filter((p) => p.availableQuantity > 0);

      if (sort === 'price_asc') list.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
      if (sort === 'price_desc') list.sort((a, b) => b.price - a.price || a.id.localeCompare(b.id));
      if (sort === 'name_asc') list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

      const totalItems = list.length;
      const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
      const sliced = list.slice((pageNum - 1) * pageSize, pageNum * pageSize);

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: sliced,
          pagination: { page: pageNum, pageSize, totalItems, totalPages },
        }),
      });
    }

    if (method === 'GET' && path.startsWith('/products/')) {
      const id = decodeURIComponent(path.replace('/products/', ''));
      const found = state.products.find((p) => p.id === id && p.active);
      if (!found) return jsonError(route, 404, 'NOT_FOUND', 'Product not found.');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: found }),
      });
    }

    // 4. Cart
    if (path.startsWith('/cart')) {
      if (!requireAuth()) return jsonError(route, 401, 'UNAUTHENTICATED', 'Sign in required.');
      if (method === 'GET' && path === '/cart') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: buildCartResponse(state) }),
        });
      }
      if (!checkCsrf()) return jsonError(route, 403, 'CSRF_INVALID', 'Invalid CSRF token.');

      const body = req.postDataJSON() as Record<string, unknown>;
      if (body.cartVersion !== state.cart.version) {
        return jsonError(route, 409, 'VERSION_CONFLICT', 'Cart version mismatch.');
      }

      if (method === 'POST' && path === '/cart/items') {
        const productId = String(body.productId);
        const qty = Number(body.quantity);
        const existing = state.cart.items.find((i) => i.productId === productId);
        if (existing) {
          existing.quantity = Math.min(99, existing.quantity + qty);
        } else {
          state.cart.items.push({ productId, quantity: qty });
        }
        state.cart.version += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: buildCartResponse(state) }),
        });
      }

      if (method === 'PATCH' && path.startsWith('/cart/items/')) {
        const productId = decodeURIComponent(path.replace('/cart/items/', ''));
        const existing = state.cart.items.find((i) => i.productId === productId);
        if (!existing) return jsonError(route, 404, 'NOT_FOUND', 'Cart item not found.');
        existing.quantity = Number(body.quantity);
        state.cart.version += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: buildCartResponse(state) }),
        });
      }

      if (method === 'DELETE' && path.startsWith('/cart/items/')) {
        const productId = decodeURIComponent(path.replace('/cart/items/', ''));
        state.cart.items = state.cart.items.filter((i) => i.productId !== productId);
        state.cart.version += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: buildCartResponse(state) }),
        });
      }
    }

    // 5. Orders
    if (path === '/orders' && method === 'GET') {
      if (!requireAuth()) return jsonError(route, 401, 'UNAUTHENTICATED', 'Sign in required.');
      const status = url.searchParams.get('status') || '';
      const filtered = status ? state.orders.filter((o) => o.status === status) : state.orders;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: filtered,
          pagination: { page: 1, pageSize: 10, totalItems: filtered.length, totalPages: filtered.length ? 1 : 0 },
        }),
      });
    }

    if (path === '/orders' && method === 'POST') {
      if (!requireAuth()) return jsonError(route, 401, 'UNAUTHENTICATED', 'Sign in required.');
      if (!checkCsrf()) return jsonError(route, 403, 'CSRF_INVALID', 'Invalid CSRF token.');
      const idemKey = req.headers()['idempotency-key'] || null;
      if (!idemKey || idemKey.length < 16) {
        return jsonError(route, 400, 'VALIDATION_ERROR', 'Missing Idempotency-Key header.');
      }
      state.lastOrderIdempotencyKey = idemKey;
      const body = req.postDataJSON() as {
        cartVersion: number;
        shippingAddress: MockState['orders'][number]['shippingAddress'];
      };
      const cartSnap = buildCartResponse(state);
      const newOrder: MockState['orders'][number] = {
        id: 'dddd3333-3333-4333-8333-333333333333',
        status: 'PENDING_PAYMENT',
        items: cartSnap.items.map((i) => ({
          productId: i.product.id,
          sku: i.product.sku,
          name: i.product.name,
          unitPrice: i.product.price,
          quantity: i.quantity,
          lineTotal: i.lineTotal,
        })),
        shippingAddress: body.shippingAddress,
        subtotal: cartSnap.subtotal,
        shippingTotal: 0,
        taxTotal: 0,
        grandTotal: cartSnap.grandTotal,
        currency: 'USD',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        reservationExpiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
        paidAt: null,
        cancellationRequestedAt: null,
        version: 1,
      };
      state.orders.unshift(newOrder);
      state.cart.items = [];
      state.cart.version += 1;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: newOrder }),
      });
    }

    if (path.startsWith('/orders/') && path.endsWith('/cancel') && method === 'POST') {
      if (!requireAuth()) return jsonError(route, 401, 'UNAUTHENTICATED', 'Sign in required.');
      if (!checkCsrf()) return jsonError(route, 403, 'CSRF_INVALID', 'Invalid CSRF token.');
      const id = decodeURIComponent(path.replace('/orders/', '').replace('/cancel', ''));
      const order = state.orders.find((o) => o.id === id);
      if (!order) return jsonError(route, 404, 'NOT_FOUND', 'Order not found.');
      if (order.status !== 'PENDING_PAYMENT') {
        return jsonError(route, 409, 'ORDER_NOT_CANCELLABLE', 'Order cannot be cancelled.');
      }
      order.status = 'CANCELLED';
      order.version += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { order, pending: false } }),
      });
    }

    if (path.startsWith('/orders/') && method === 'GET') {
      if (!requireAuth()) return jsonError(route, 401, 'UNAUTHENTICATED', 'Sign in required.');
      const id = decodeURIComponent(path.replace('/orders/', ''));
      const order = state.orders.find((o) => o.id === id);
      if (!order) return jsonError(route, 404, 'NOT_FOUND', 'Order not found.');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: order }),
      });
    }

    if (path.startsWith('/orders/') && method === 'DELETE') {
      if (!requireAuth()) return jsonError(route, 401, 'UNAUTHENTICATED', 'Sign in required.');
      if (!checkCsrf()) return jsonError(route, 403, 'CSRF_INVALID', 'Invalid CSRF token.');
      const id = decodeURIComponent(path.replace('/orders/', ''));
      const idx = state.orders.findIndex((o) => o.id === id);
      if (idx === -1) return jsonError(route, 404, 'NOT_FOUND', 'Order not found.');
      state.orders.splice(idx, 1);
      return route.fulfill({ status: 204, body: '' });
    }

    // 6. Checkout
    if (path === '/checkout/sessions' && method === 'POST') {
      if (!requireAuth()) return jsonError(route, 401, 'UNAUTHENTICATED', 'Sign in required.');
      if (!checkCsrf()) return jsonError(route, 403, 'CSRF_INVALID', 'Invalid CSRF token.');
      const idemKey = req.headers()['idempotency-key'] || null;
      if (!idemKey || idemKey.length < 16) {
        return jsonError(route, 400, 'VALIDATION_ERROR', 'Missing Idempotency-Key header.');
      }
      state.lastCheckoutIdempotencyKey = idemKey;
      const body = req.postDataJSON() as { orderId: string };
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            orderId: body.orderId,
            sessionId: 'cs_test_123456',
            checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123456',
            expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
          },
        }),
      });
    }

    // 7. Admin Products
    if (path.startsWith('/admin/products')) {
      if (!requireAuth()) return jsonError(route, 401, 'UNAUTHENTICATED', 'Sign in required.');
      if (!requireAdmin()) return jsonError(route, 403, 'FORBIDDEN', 'Admin role required.');

      if (method === 'GET' && path === '/admin/products') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: state.products,
            pagination: {
              page: 1,
              pageSize: 10,
              totalItems: state.products.length,
              totalPages: state.products.length ? 1 : 0,
            },
          }),
        });
      }

      if (!checkCsrf()) return jsonError(route, 403, 'CSRF_INVALID', 'Invalid CSRF token.');

      if (method === 'POST' && path === '/admin/products') {
        const body = req.postDataJSON() as {
          sku: string;
          name: string;
          description: string;
          categoryId: string;
          price: number;
          imageUrl: string | null;
          stockOnHand: number;
          active: boolean;
        };
        const cat = state.categories.find((c) => c.id === body.categoryId) || state.categories[0];
        const created = {
          id: 'aaaa4444-4444-4444-8444-444444444444',
          sku: body.sku,
          name: body.name,
          description: body.description,
          category: cat,
          price: body.price,
          currency: 'USD' as const,
          imageUrl: body.imageUrl,
          availableQuantity: body.stockOnHand,
          active: body.active,
          version: 1,
        };
        state.products.unshift(created);
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ data: created }),
        });
      }

      if (method === 'DELETE' && path.startsWith('/admin/products/')) {
        const id = decodeURIComponent(path.replace('/admin/products/', ''));
        const prod = state.products.find((p) => p.id === id);
        if (!prod) return jsonError(route, 404, 'NOT_FOUND', 'Product not found.');
        prod.active = false;
        prod.version += 1;
        return route.fulfill({ status: 204, body: '' });
      }
    }

    // 8. Admin Orders
    if (path.startsWith('/admin/orders')) {
      if (!requireAuth()) return jsonError(route, 401, 'UNAUTHENTICATED', 'Sign in required.');
      if (!requireAdmin()) return jsonError(route, 403, 'FORBIDDEN', 'Admin role required.');

      if (method === 'GET' && path === '/admin/orders') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: state.orders,
            pagination: {
              page: 1,
              pageSize: 10,
              totalItems: state.orders.length,
              totalPages: state.orders.length ? 1 : 0,
            },
          }),
        });
      }

      if (method === 'GET' && path.startsWith('/admin/orders/')) {
        const id = decodeURIComponent(path.replace('/admin/orders/', ''));
        const order = state.orders.find((o) => o.id === id);
        if (!order) return jsonError(route, 404, 'NOT_FOUND', 'Order not found.');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: order }),
        });
      }

      if (method === 'PATCH' && path.endsWith('/status')) {
        if (!checkCsrf()) return jsonError(route, 403, 'CSRF_INVALID', 'Invalid CSRF token.');
        const id = decodeURIComponent(path.replace('/admin/orders/', '').replace('/status', ''));
        const body = req.postDataJSON() as { status: 'PROCESSING' | 'SHIPPED'; version: number };
        const order = state.orders.find((o) => o.id === id);
        if (!order) return jsonError(route, 404, 'NOT_FOUND', 'Order not found.');
        order.status = body.status;
        order.version += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: order }),
        });
      }

      if (method === 'POST' && path === '/admin/orders') {
        if (!checkCsrf()) return jsonError(route, 403, 'CSRF_INVALID', 'Invalid CSRF token.');
        const body = req.postDataJSON() as {
          items: { productId: string; quantity: number }[];
          shippingAddress: MockState['orders'][number]['shippingAddress'];
        };
        const items = body.items.map((it) => {
          const p = state.products.find((prod) => prod.id === it.productId) || state.products[0];
          return {
            productId: p.id,
            sku: p.sku,
            name: p.name,
            unitPrice: p.price,
            quantity: it.quantity,
            lineTotal: p.price * it.quantity,
          };
        });
        const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
        const created: MockState['orders'][number] = {
          id: 'dddd3333-3333-4333-8333-333333333333',
          status: 'PENDING_PAYMENT',
          items,
          shippingAddress: body.shippingAddress,
          subtotal,
          shippingTotal: 0,
          taxTotal: 0,
          grandTotal: subtotal,
          currency: 'USD',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          reservationExpiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
          paidAt: null,
          cancellationRequestedAt: null,
          version: 1,
        };
        state.orders.unshift(created);
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ data: created }),
        });
      }

      if (method === 'PATCH' && path.startsWith('/admin/orders/') && !path.endsWith('/status')) {
        if (!checkCsrf()) return jsonError(route, 403, 'CSRF_INVALID', 'Invalid CSRF token.');
        const id = decodeURIComponent(path.replace('/admin/orders/', ''));
        const body = req.postDataJSON() as {
          status?: MockState['orders'][number]['status'];
          shippingAddress?: MockState['orders'][number]['shippingAddress'];
          version: number;
        };
        const order = state.orders.find((o) => o.id === id);
        if (!order) return jsonError(route, 404, 'NOT_FOUND', 'Order not found.');
        if (body.status) order.status = body.status;
        if (body.shippingAddress) order.shippingAddress = body.shippingAddress;
        order.version += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: order }),
        });
      }

      if (method === 'DELETE' && path.startsWith('/admin/orders/')) {
        if (!checkCsrf()) return jsonError(route, 403, 'CSRF_INVALID', 'Invalid CSRF token.');
        const id = decodeURIComponent(path.replace('/admin/orders/', ''));
        const idx = state.orders.findIndex((o) => o.id === id);
        if (idx === -1) return jsonError(route, 404, 'NOT_FOUND', 'Order not found.');
        state.orders.splice(idx, 1);
        return route.fulfill({ status: 204, body: '' });
      }
    }

    // 9. AI Support
    if (method === 'POST' && path === '/support/messages') {
      const body = req.postDataJSON() as { message: string };
      const msg = body.message.toLowerCase();
      if (msg.includes('shipping')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              answer: 'Standard US test-market shipping is currently $0.00 in demo mode.',
              citations: [
                {
                  documentId: 'doc-shipping-1',
                  title: 'Shipping Policy',
                  version: '1.0',
                  section: 'US Shipping Rates',
                },
              ],
              escalated: false,
            },
          }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            answer:
              'I cannot confirm this from approved store information. Please contact store support.',
            citations: [],
            escalated: true,
          },
        }),
      });
    }

    return jsonError(route, 404, 'NOT_FOUND', `Unhandled mock route: ${method} ${path}`);
  });
}
