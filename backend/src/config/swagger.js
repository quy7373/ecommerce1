const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'E-Commerce Backend API',
    version: '1.0.0',
    description:
      'Authoritative API v1 implementation aligned with docs/api/api-contract.md and SEC-001 security controls.',
  },
  servers: [{ url: '/api/v1', description: 'API v1 Base Path' }],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: '__Host-session',
      },
      csrfHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
      },
    },
    schemas: {
      ErrorBody: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'details', 'requestId'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['field', 'code', 'message'],
                  properties: {
                    field: { type: 'string' },
                    code: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
              requestId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
      User: {
        type: 'object',
        required: ['id', 'email', 'displayName', 'role'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string' },
          displayName: { type: 'string' },
          role: { type: 'string', enum: ['CUSTOMER', 'ADMIN'] },
        },
      },
      Category: {
        type: 'object',
        required: ['id', 'name', 'slug'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          slug: { type: 'string' },
        },
      },
      Product: {
        type: 'object',
        required: ['id', 'sku', 'name', 'description', 'category', 'price', 'currency', 'imageUrl', 'availableQuantity', 'active', 'version'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          sku: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          category: { $ref: '#/components/schemas/Category' },
          price: { type: 'integer', minimum: 1, maximum: 100000000 },
          currency: { type: 'string', enum: ['USD'] },
          imageUrl: { type: 'string', nullable: true },
          availableQuantity: { type: 'integer', minimum: 0 },
          active: { type: 'boolean' },
          version: { type: 'integer', minimum: 1 },
        },
      },
    },
  },
  paths: {
    '/health/live': {
      get: {
        summary: 'Liveness probe',
        tags: ['Health'],
        responses: { 200: { description: 'Service is live' } },
      },
    },
    '/health/ready': {
      get: {
        summary: 'Readiness probe (database connectivity)',
        tags: ['Health'],
        responses: {
          200: { description: 'Service is ready' },
          503: { description: 'Database unavailable' },
        },
      },
    },
    '/auth/google': {
      get: {
        summary: 'Initiate Google OIDC login',
        tags: ['Auth'],
        responses: { 302: { description: 'Redirect to Google authorization URL' } },
      },
    },
    '/auth/google/callback': {
      get: {
        summary: 'Handle Google OIDC callback',
        tags: ['Auth'],
        responses: { 302: { description: 'Redirect to /account with session cookie' } },
      },
    },
    '/auth/session': {
      get: {
        summary: 'Get current session and rotate CSRF token',
        tags: ['Auth'],
        security: [{ sessionCookie: [] }],
        responses: { 200: { description: 'Current user, CSRF token, and expiry' } },
      },
    },
    '/auth/logout': {
      post: {
        summary: 'Revoke current session and clear cookie',
        tags: ['Auth'],
        security: [{ sessionCookie: [], csrfHeader: [] }],
        responses: { 204: { description: 'Logged out' } },
      },
    },
    '/products': {
      get: {
        summary: 'List active products with search, filtering, sorting, and pagination',
        tags: ['Catalog'],
        responses: { 200: { description: 'Paginated active products' } },
      },
    },
    '/products/{productId}': {
      get: {
        summary: 'Get active product details',
        tags: ['Catalog'],
        responses: { 200: { description: 'Product detail' }, 404: { description: 'Not found' } },
      },
    },
    '/categories': {
      get: {
        summary: 'List all categories sorted by name ascending',
        tags: ['Catalog'],
        responses: { 200: { description: 'Categories list' } },
      },
    },
    '/cart': {
      get: {
        summary: 'Get or lazily create user cart',
        tags: ['Cart'],
        security: [{ sessionCookie: [] }],
        responses: { 200: { description: 'User cart' } },
      },
    },
    '/cart/items': {
      post: {
        summary: 'Add item to cart',
        tags: ['Cart'],
        security: [{ sessionCookie: [], csrfHeader: [] }],
        responses: { 200: { description: 'Updated cart' } },
      },
    },
    '/cart/items/{productId}': {
      patch: {
        summary: 'Update cart item quantity',
        tags: ['Cart'],
        security: [{ sessionCookie: [], csrfHeader: [] }],
        responses: { 200: { description: 'Updated cart' } },
      },
      delete: {
        summary: 'Remove cart item',
        tags: ['Cart'],
        security: [{ sessionCookie: [], csrfHeader: [] }],
        responses: { 200: { description: 'Updated cart' } },
      },
    },
    '/orders': {
      get: {
        summary: 'List authenticated user orders',
        tags: ['Orders'],
        security: [{ sessionCookie: [] }],
        responses: { 200: { description: 'Paginated orders' } },
      },
      post: {
        summary: 'Create order from cart with atomic stock reservation',
        tags: ['Orders'],
        security: [{ sessionCookie: [], csrfHeader: [] }],
        responses: { 201: { description: 'Order created' } },
      },
    },
    '/orders/{orderId}': {
      get: {
        summary: 'Get owned order details',
        tags: ['Orders'],
        security: [{ sessionCookie: [] }],
        responses: { 200: { description: 'Order detail' } },
      },
    },
    '/orders/{orderId}/cancel': {
      post: {
        summary: 'Request pending order cancellation',
        tags: ['Orders'],
        security: [{ sessionCookie: [], csrfHeader: [] }],
        responses: {
          200: { description: 'Order cancelled' },
          202: { description: 'Cancellation pending provider reconciliation' },
        },
      },
    },
    '/checkout/sessions': {
      post: {
        summary: 'Create or reuse Stripe Checkout session for pending order',
        tags: ['Checkout'],
        security: [{ sessionCookie: [], csrfHeader: [] }],
        responses: { 201: { description: 'Checkout session created' } },
      },
    },
    '/webhooks/stripe': {
      post: {
        summary: 'Receive verified Stripe webhook notifications',
        tags: ['Webhooks'],
        responses: { 200: { description: 'Event durably recorded' } },
      },
    },
    '/admin/orders': {
      get: {
        summary: 'List all orders (Admin)',
        tags: ['Admin'],
        security: [{ sessionCookie: [] }],
        responses: { 200: { description: 'Paginated orders' } },
      },
    },
    '/admin/orders/{orderId}': {
      get: {
        summary: 'Get any order detail (Admin)',
        tags: ['Admin'],
        security: [{ sessionCookie: [] }],
        responses: { 200: { description: 'Order detail' } },
      },
    },
    '/admin/orders/{orderId}/status': {
      patch: {
        summary: 'Advance order fulfillment status PAID->PROCESSING->SHIPPED (Admin)',
        tags: ['Admin'],
        security: [{ sessionCookie: [], csrfHeader: [] }],
        responses: { 200: { description: 'Updated order' } },
      },
    },
    '/admin/products': {
      get: {
        summary: 'List all products including inactive (Admin)',
        tags: ['Admin'],
        security: [{ sessionCookie: [] }],
        responses: { 200: { description: 'Paginated products' } },
      },
      post: {
        summary: 'Create product (Admin)',
        tags: ['Admin'],
        security: [{ sessionCookie: [], csrfHeader: [] }],
        responses: { 201: { description: 'Product created' } },
      },
    },
    '/admin/products/{productId}': {
      get: {
        summary: 'Get product including inactive (Admin)',
        tags: ['Admin'],
        security: [{ sessionCookie: [] }],
        responses: { 200: { description: 'Product detail' } },
      },
      patch: {
        summary: 'Update product with optimistic locking (Admin)',
        tags: ['Admin'],
        security: [{ sessionCookie: [], csrfHeader: [] }],
        responses: { 200: { description: 'Updated product' } },
      },
      delete: {
        summary: 'Soft-archive product (Admin)',
        tags: ['Admin'],
        security: [{ sessionCookie: [], csrfHeader: [] }],
        responses: { 204: { description: 'Product archived' } },
      },
    },
    '/support/messages': {
      post: {
        summary: 'Public grounded FAQ/policy support assistant',
        tags: ['Support'],
        responses: { 200: { description: 'Cited answer or deterministic escalation' } },
      },
    },
  },
};

module.exports = { openApiSpec };
