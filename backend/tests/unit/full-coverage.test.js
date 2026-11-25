const crypto = require('crypto');
const { parseCatalogQuery } = require('../../src/modules/products/products.validator');
const { methodNotAllowed, notFoundHandler, errorHandler } = require('../../src/middleware/errorHandler');
const { AppError, validationError, formatErrorBody } = require('../../src/config/errors');
const { loadConfig } = require('../../src/config/env');
const { runSerializableTransaction } = require('../../src/config/prisma');
const { StripeClient, validateStripeCheckoutUrl } = require('../../src/integrations/stripe/stripe.client');
const { CartService, formatCartDto } = require('../../src/modules/cart/cart.service');
const { OrdersService } = require('../../src/modules/orders/orders.service');
const { PaymentsService } = require('../../src/modules/payments/payments.service');
const { AdminService } = require('../../src/modules/admin/admin.service');
const { AuthMailWorker, sanitizeMailErrorCode } = require('../../src/modules/auth/authMail.worker');
const { ChatService } = require('../../src/modules/chat/chat.service');
const { encryptEnvelope } = require('../../src/config/crypto');

const SAMPLE_UUID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_ADDRESS = {
  fullName: 'Jane Doe',
  line1: '123 Main St',
  city: 'Austin',
  region: 'TX',
  postalCode: '78701',
  country: 'US',
};

describe('Unit: Products Validator, Error Handler, Config & Prisma', () => {
  it('parseCatalogQuery validates all valid and invalid query parameters', () => {
    const valid = parseCatalogQuery(
      {
        q: 'Keyboard',
        categoryId: SAMPLE_UUID,
        minPrice: '100',
        maxPrice: '5000',
        inStock: 'true',
        active: 'false',
        sort: 'price_desc',
        page: '2',
        pageSize: '24',
      },
      { allowActiveFilter: true }
    );
    expect(valid).toEqual({
      q: 'Keyboard',
      categoryId: SAMPLE_UUID,
      minPrice: 100,
      maxPrice: 5000,
      inStock: true,
      active: false,
      sort: 'price_desc',
      page: 2,
      pageSize: 24,
    });

    const validFalse = parseCatalogQuery({ inStock: 'false', active: 'true' }, { allowActiveFilter: true });
    expect(validFalse.inStock).toBe(false);
    expect(validFalse.active).toBe(true);

    expect(() =>
      parseCatalogQuery(
        {
          unknownParam: '1',
          q: '',
          categoryId: 'bad-uuid',
          minPrice: '500',
          maxPrice: '100',
          inStock: 'yes',
          active: 'nope',
          sort: 'invalid_sort',
          page: '0',
          pageSize: '999',
        },
        { allowActiveFilter: true }
      )
    ).toThrow(AppError);

    expect(() => parseCatalogQuery({ q: 123 })).toThrow(AppError);
  });

  it('errorHandler, methodNotAllowed, and notFoundHandler handle all error classes', () => {
    const headers = {};
    const res = {
      statusCode: 200,
      body: null,
      setHeader: (k, v) => {
        headers[k] = v;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    const req = { method: 'PATCH', requestId: 'req-123' };

    const next = jest.fn();
    methodNotAllowed(['GET', 'POST'])(req, res, next);
    expect(headers.Allow).toBe('GET, POST');
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 405, code: 'METHOD_NOT_ALLOWED' }));

    next.mockClear();
    notFoundHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404, code: 'NOT_FOUND' }));

    // AppError with extraHeaders
    const rateErr = new AppError(429, 'RATE_LIMITED', 'Slow down', [], { 'Retry-After': '30' });
    errorHandler(rateErr, req, res, next);
    expect(res.statusCode).toBe(429);
    expect(headers['Retry-After']).toBe('30');
    expect(res.body.error.code).toBe('RATE_LIMITED');

    // Prisma P2002 -> 409 CONFLICT
    errorHandler({ code: 'P2002' }, req, res, next);
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');

    // Prisma P2025 -> 404 NOT_FOUND
    errorHandler({ code: 'P2025' }, req, res, next);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    // Unknown error -> 500 INTERNAL_ERROR
    errorHandler(new Error('boom'), req, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');

    // validationError & formatErrorBody
    const valErr = validationError([{ field: 'a', code: 'REQUIRED', message: 'req' }]);
    expect(valErr.status).toBe(400);
    expect(formatErrorBody({ code: 'X', message: 'Y', requestId: 'r1' }).error.details).toEqual([]);
  });

  it('loadConfig enforces production secrets, test-mode Stripe keys, and parses TRUST_PROXY', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_PRIVATE_KEY_PEM/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        STRIPE_SECRET_KEY: 'sk_live_forbidden',
      })
    ).toThrow(/Live Stripe secret keys/);

    const keyB64 = crypto.randomBytes(32).toString('base64');
    const cfg = loadConfig({
      NODE_ENV: 'development',
      ENCRYPTION_MASTER_KEY: keyB64,
      MAIL_ENCRYPTION_MASTER_KEY: keyB64,
      TRUST_PROXY: '2',
    });
    expect(cfg.trustProxy).toBe(2);
    expect(cfg.encryption.masterKey).toHaveLength(32);
    expect(cfg.mailEncryption.masterKey).toHaveLength(32);

    expect(loadConfig({ NODE_ENV: 'development', TRUST_PROXY: 'true' }).trustProxy).toBe(1);
    expect(loadConfig({ NODE_ENV: 'development', TRUST_PROXY: 'loopback' }).trustProxy).toBe('loopback');
  });

  it('runSerializableTransaction retries on P2034 serialization conflict and rethrows other errors', async () => {
    let attempts = 0;
    const prisma = {
      $transaction: jest.fn(async (fn) => {
        attempts += 1;
        if (attempts < 2) {
          const err = new Error('serialization');
          err.code = 'P2034';
          throw err;
        }
        return fn({});
      }),
    };
    const result = await runSerializableTransaction(prisma, async () => 'ok');
    expect(result).toBe('ok');
    expect(attempts).toBe(2);

    const failingPrisma = {
      $transaction: jest.fn(async () => {
        throw new Error('fatal');
      }),
    };
    await expect(runSerializableTransaction(failingPrisma, async () => 'ok')).rejects.toThrow('fatal');
  });
});

describe('Unit: StripeClient & Webhook Rotation', () => {
  it('validates Stripe checkout URLs and wraps SDK methods safely', async () => {
    expect(() => validateStripeCheckoutUrl('not-a-url')).toThrow(AppError);
    expect(() => validateStripeCheckoutUrl('http://checkout.stripe.com/c/pay/1')).toThrow(AppError);
    expect(() => validateStripeCheckoutUrl('https://evil.example.com/c/pay/1')).toThrow(AppError);
    expect(validateStripeCheckoutUrl('https://checkout.stripe.com/c/pay/1')).toBe(
      'https://checkout.stripe.com/c/pay/1'
    );

    const unconfigured = new StripeClient({ secretKey: '' }, 'http://localhost:5174');
    await expect(unconfigured.retrieveCheckoutSession('cs_1')).rejects.toMatchObject({
      status: 503,
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    });

    const client = new StripeClient({ secretKey: 'sk_test_dummy', webhookSecret: 'whsec_new', webhookSecretPrevious: 'whsec_old' }, 'http://localhost:5174');
    const realWebhooks = client.sdk.webhooks;
    client.sdk = {
      webhooks: realWebhooks,
      checkout: {
        sessions: {
          create: jest.fn(async () => ({
            id: 'cs_test_1',
            url: 'https://checkout.stripe.com/c/pay/cs_test_1',
            expires_at: Math.floor(Date.now() / 1000) + 1800,
            payment_status: 'unpaid',
            status: 'open',
          })),
          retrieve: jest.fn(async () => ({ id: 'cs_test_1', status: 'open' })),
          expire: jest.fn(async () => ({ id: 'cs_test_1', status: 'expired' })),
        },
      },
    };

    const created = await client.createCheckoutSession({
      order: {
        id: 'ord-1',
        items: [{ name: 'Mouse', sku: 'SKU-1', unitPrice: 5000, quantity: 1 }],
      },
      expiresAtUnix: Math.floor(Date.now() / 1000) + 1800,
      idempotencyKey: 'ik-1',
    });
    expect(created.id).toBe('cs_test_1');
    expect((await client.retrieveCheckoutSession('cs_test_1')).status).toBe('open');
    expect((await client.expireCheckoutSession('cs_test_1')).status).toBe('expired');

    // SDK error wrapping
    client.sdk.checkout.sessions.create.mockRejectedValueOnce(new Error('network'));
    await expect(
      client.createCheckoutSession({ order: { id: 'o1', items: [] }, expiresAtUnix: 1, idempotencyKey: 'k' })
    ).rejects.toMatchObject({ status: 503 });

    client.sdk.checkout.sessions.retrieve.mockRejectedValueOnce(new Error('network'));
    await expect(client.retrieveCheckoutSession('cs_1')).rejects.toMatchObject({ status: 503 });

    client.sdk.checkout.sessions.expire.mockRejectedValueOnce(new Error('network'));
    await expect(client.expireCheckoutSession('cs_1')).rejects.toMatchObject({ status: 503 });

    // Missing signature header
    expect(() => client.verifyWebhookEvent(Buffer.from('{}'), '')).toThrow(AppError);

    // Rotation: signed with previous secret succeeds
    const ts = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      id: 'evt_1',
      livemode: false,
      type: 'checkout.session.completed',
      created: ts,
      data: { object: { id: 'cs_test_1' } },
    });
    const sig = crypto.createHmac('sha256', 'whsec_old').update(`${ts}.${payload}`).digest('hex');
    const event = client.verifyWebhookEvent(Buffer.from(payload), `t=${ts},v1=${sig}`);
    expect(event.id).toBe('evt_1');
  });
});

describe('Unit: CartService full paths', () => {
  function makeProduct(overrides = {}) {
    return {
      id: 'prod-1',
      sku: 'SKU-1',
      name: 'Keyboard',
      description: 'Desc',
      price: 10000,
      currency: 'USD',
      imageUrl: null,
      stockOnHand: 10,
      stockReserved: 0,
      active: true,
      version: 1,
      category: { id: SAMPLE_UUID, name: 'Electronics', slug: 'electronics' },
      ...overrides,
    };
  }

  it('handles addItem, updateItem, removeItem, and conflict/stock/limit errors', async () => {
    let cart = {
      id: 'cart-1',
      userId: 'u1',
      version: 1,
      items: [],
    };
    const product = makeProduct();
    const prisma = {
      $transaction: async (fn) => fn(prisma),
      cart: {
        findUnique: jest.fn(async () => cart),
        create: jest.fn(async () => cart),
        update: jest.fn(async ({ data }) => {
          cart = { ...cart, version: data.version };
          return cart;
        }),
      },
      product: {
        findUnique: jest.fn(async ({ where }) => (where.id === 'prod-1' ? product : null)),
      },
      cartItem: {
        create: jest.fn(async ({ data }) => {
          cart.items.push({ id: data.id, productId: data.productId, quantity: data.quantity, product });
        }),
        update: jest.fn(async ({ where, data }) => {
          const item = cart.items.find((i) => i.id === where.id);
          if (item) item.quantity = data.quantity;
        }),
        delete: jest.fn(async ({ where }) => {
          cart.items = cart.items.filter((i) => i.id !== where.id);
        }),
      },
    };

    const svc = new CartService(prisma);
    expect((await svc.getCart('u1')).items).toEqual([]);

    // Add item
    const added = await svc.addItem('u1', { productId: 'prod-1', quantity: 2, cartVersion: 1 });
    expect(added.version).toBe(2);
    expect(added.subtotal).toBe(20000);

    // Add more of same item
    const addedMore = await svc.addItem('u1', { productId: 'prod-1', quantity: 1, cartVersion: 2 });
    expect(addedMore.items[0].quantity).toBe(3);

    // Version conflict
    await expect(
      svc.addItem('u1', { productId: 'prod-1', quantity: 1, cartVersion: 1 })
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });

    // Product not found
    await expect(
      svc.addItem('u1', { productId: 'missing', quantity: 1, cartVersion: 3 })
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });

    // Out of stock
    await expect(
      svc.addItem('u1', { productId: 'prod-1', quantity: 20, cartVersion: 3 })
    ).rejects.toMatchObject({ status: 409, code: 'OUT_OF_STOCK' });

    // Update item
    const updated = await svc.updateItem('u1', 'prod-1', { quantity: 4, cartVersion: 3 });
    expect(updated.items[0].quantity).toBe(4);

    await expect(
      svc.updateItem('u1', 'prod-1', { quantity: 1, cartVersion: 1 })
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    await expect(
      svc.updateItem('u1', 'missing', { quantity: 1, cartVersion: 4 })
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(
      svc.updateItem('u1', 'prod-1', { quantity: 50, cartVersion: 4 })
    ).rejects.toMatchObject({ status: 409, code: 'OUT_OF_STOCK' });

    // Remove item
    await expect(
      svc.removeItem('u1', 'prod-1', { cartVersion: 1 })
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    await expect(
      svc.removeItem('u1', 'missing', { cartVersion: 4 })
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });

    const removed = await svc.removeItem('u1', 'prod-1', { cartVersion: 4 });
    expect(removed.items).toHaveLength(0);

    // Overflow subtotal bound
    expect(() =>
      formatCartDto({
        id: 'c',
        version: 1,
        items: [{ productId: 'p1', quantity: 1000, product: makeProduct({ price: 999_999_999 }) }],
      })
    ).toThrow(AppError);
  });
});

describe('Unit: OrdersService & PaymentsService & AdminService', () => {
  function makeEncryptedOrder(overrides = {}) {
    const id = overrides.id || '22222222-2222-4222-8222-222222222222';
    return {
      id,
      userId: 'u1',
      cartId: 'c1',
      cartVersion: 1,
      status: 'PENDING_PAYMENT',
      checkoutState: 'NOT_STARTED',
      stripeSessionId: null,
      shippingAddress: encryptEnvelope(SAMPLE_ADDRESS, {
        entity: 'Order',
        rowId: id,
        field: 'shippingAddress',
      }),
      subtotal: 10000,
      shippingTotal: 0,
      taxTotal: 0,
      grandTotal: 10000,
      currency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      reservationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      paidAt: null,
      cancellationRequestedAt: null,
      version: 1,
      items: [
        {
          productId: 'prod-1',
          sku: 'SKU-1',
          name: 'Keyboard',
          unitPrice: 10000,
          quantity: 1,
          lineTotal: 10000,
        },
      ],
      reservations: [
        { id: 'res-1', productId: 'prod-1', quantity: 1, status: 'ACTIVE' },
      ],
      ...overrides,
    };
  }

  it('OrdersService covers listOrders, getOrder 404, and all cancelOrder branches', async () => {
    const baseOrder = makeEncryptedOrder();
    let currentOrder = { ...baseOrder };
    const prisma = {
      $transaction: async (fn) => fn(prisma),
      webhookEvent: {
        findMany: jest.fn(async () => []),
      },
      order: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [currentOrder]),
        findFirst: jest.fn(async ({ where }) => (where.id === currentOrder.id ? currentOrder : null)),
        findUnique: jest.fn(async () => currentOrder),
        update: jest.fn(async ({ data }) => {
          currentOrder = { ...currentOrder, ...data };
          return currentOrder;
        }),
      },
      inventoryReservation: { update: jest.fn(async () => ({})) },
      product: {
        findUnique: jest.fn(async () => ({ id: 'prod-1', stockReserved: 2, version: 1 })),
        update: jest.fn(async () => ({})),
      },
    };
    const stripeClient = {
      retrieveCheckoutSession: jest.fn(),
      expireCheckoutSession: jest.fn(async () => ({})),
    };
    const onOrderAlreadyPaid = jest.fn(async () => ({}));
    const svc = new OrdersService(prisma, {
      idempotencyService: {},
      stripeClient,
      onOrderAlreadyPaid,
    });

    const listed = await svc.listOrders({ userId: 'u1', status: 'PENDING_PAYMENT' });
    expect(listed.data).toHaveLength(1);
    await expect(svc.getOrder({ orderId: 'nonexistent', userId: 'u1' })).rejects.toMatchObject({ status: 404 });

    // Branch 1: Immediate cancel (NOT_STARTED, no stripeSessionId)
    const cancelledImmediate = await svc.cancelOrder({ orderId: currentOrder.id, userId: 'u1' });
    expect(cancelledImmediate.statusCode).toBe(200);
    expect(cancelledImmediate.data.order.status).toBe('CANCELLED');

    // Branch 2: Already CANCELLED -> idempotent 200
    const alreadyCancelled = await svc.cancelOrder({ orderId: currentOrder.id, userId: 'u1' });
    expect(alreadyCancelled.statusCode).toBe(200);

    // Branch 3: PAID -> 409 ORDER_NOT_CANCELLABLE
    currentOrder = makeEncryptedOrder({ status: 'PAID' });
    await expect(svc.cancelOrder({ orderId: currentOrder.id, userId: 'u1' })).rejects.toMatchObject({
      status: 409,
      code: 'ORDER_NOT_CANCELLABLE',
    });

    // Branch 4: Stripe already paid -> calls onOrderAlreadyPaid & throws 409
    currentOrder = makeEncryptedOrder({
      status: 'PENDING_PAYMENT',
      checkoutState: 'READY',
      stripeSessionId: 'cs_paid',
    });
    stripeClient.retrieveCheckoutSession.mockResolvedValueOnce({
      id: 'cs_paid',
      payment_status: 'paid',
      status: 'complete',
    });
    await expect(svc.cancelOrder({ orderId: currentOrder.id, userId: 'u1' })).rejects.toMatchObject({
      status: 409,
      code: 'ORDER_NOT_CANCELLABLE',
    });
    expect(onOrderAlreadyPaid).toHaveBeenCalled();

    // Branch 5: Stripe open -> expires and cancels
    currentOrder = makeEncryptedOrder({
      status: 'PENDING_PAYMENT',
      checkoutState: 'READY',
      stripeSessionId: 'cs_open',
    });
    stripeClient.retrieveCheckoutSession.mockResolvedValueOnce({
      id: 'cs_open',
      payment_status: 'unpaid',
      status: 'open',
    });
    const cancelledOpen = await svc.cancelOrder({ orderId: currentOrder.id, userId: 'u1' });
    expect(cancelledOpen.statusCode).toBe(200);
    expect(stripeClient.expireCheckoutSession).toHaveBeenCalledWith('cs_open');

    // Branch 6: Stripe network error -> 202 pending
    currentOrder = makeEncryptedOrder({
      status: 'PENDING_PAYMENT',
      checkoutState: 'READY',
      stripeSessionId: 'cs_err',
    });
    stripeClient.retrieveCheckoutSession.mockRejectedValueOnce(new Error('timeout'));
    const pending202 = await svc.cancelOrder({ orderId: currentOrder.id, userId: 'u1' });
    expect(pending202.statusCode).toBe(202);
    expect(pending202.data.pending).toBe(true);
  });

  it('PaymentsService settles paid Stripe session and reconciles pending work', async () => {
    const order = makeEncryptedOrder({
      status: 'PENDING_PAYMENT',
      checkoutState: 'READY',
      stripeSessionId: 'cs_settle_1',
    });
    let currentOrder = { ...order };
    const prisma = {
      $transaction: async (fn) => fn(prisma),
      webhookEvent: {
        findMany: jest.fn(async () => []),
      },
      order: {
        findUnique: jest.fn(async () => currentOrder),
        findMany: jest.fn(async ({ where }) => {
          if (where.checkoutState === 'CREATING') return [];
          if (where.stripeSessionId === null) return [];
          return [currentOrder];
        }),
        update: jest.fn(async ({ data }) => {
          currentOrder = { ...currentOrder, ...data };
          return currentOrder;
        }),
      },
      inventoryReservation: { update: jest.fn(async () => ({})) },
      product: {
        findUnique: jest.fn(async () => ({ id: 'prod-1', stockOnHand: 10, stockReserved: 1, version: 1 })),
        update: jest.fn(async () => ({})),
      },
      payment: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 'pay-1' })),
      },
      cart: {
        findUnique: jest.fn(async () => ({ id: 'c1', version: 1 })),
        update: jest.fn(async () => ({})),
      },
      cartItem: { deleteMany: jest.fn(async () => ({ count: 1 })) },
    };

    const stripeClient = {
      retrieveCheckoutSession: jest.fn(async () => ({
        id: 'cs_settle_1',
        livemode: false,
        mode: 'payment',
        payment_status: 'paid',
        status: 'complete',
        amount_total: 10000,
        currency: 'usd',
        payment_intent: 'pi_123',
        metadata: { orderId: order.id },
      })),
      expireCheckoutSession: jest.fn(async () => ({})),
    };
    const ordersService = {
      releaseReservationsAndCancelOrder: jest.fn(async () => ({})),
    };

    const paymentsSvc = new PaymentsService(prisma, {
      stripeClient,
      ordersService,
      idempotencyService: {},
    });

    await paymentsSvc.reconcilePendingWork();
    expect(currentOrder.status).toBe('PAID');
    expect(prisma.payment.create).toHaveBeenCalled();
  });

  it('AdminService covers order CRUD (create, update status/address, delete) and product get/update', async () => {
    const order = makeEncryptedOrder({ status: 'PENDING_PAYMENT', version: 1 });
    let currentOrder = { ...order };
    const product = {
      id: 'prod-1',
      sku: 'SKU-1',
      name: 'Keyboard',
      description: 'Desc',
      price: 10000,
      currency: 'USD',
      imageUrl: null,
      stockOnHand: 10,
      stockReserved: 1,
      active: true,
      version: 1,
      categoryId: SAMPLE_UUID,
      category: { id: SAMPLE_UUID, name: 'Electronics', slug: 'electronics' },
    };

    const prisma = {
      $transaction: async (fn) => fn(prisma),
      user: { findUnique: jest.fn(async () => ({ id: 'u1', email: 'c@example.com' })) },
      cart: { findUnique: jest.fn(async () => ({ id: 'c1', version: 1 })) },
      product: {
        findMany: jest.fn(async () => [product]),
        findUnique: jest.fn(async () => product),
        update: jest.fn(async ({ data }) => ({ ...product, ...data })),
      },
      order: {
        create: jest.fn(async () => currentOrder),
        findUnique: jest.fn(async () => currentOrder),
        update: jest.fn(async ({ data }) => {
          currentOrder = { ...currentOrder, ...data };
          return currentOrder;
        }),
        delete: jest.fn(async () => ({ id: currentOrder.id })),
      },
      inventoryReservation: {
        update: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      webhookEvent: { updateMany: jest.fn(async () => ({ count: 0 })) },
      payment: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      orderItem: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      auditLog: { create: jest.fn(async () => ({})) },
    };

    const adminSvc = new AdminService(prisma, {
      productsRepository: {
        listProducts: jest.fn(async () => ({ data: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } })),
        findById: jest.fn(async (id) => (id === 'prod-1' ? product : null)),
      },
      ordersService: {
        listOrders: jest.fn(async () => ({ data: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } })),
        getOrder: jest.fn(async () => ({ id: currentOrder.id })),
      },
    });

    await adminSvc.listOrders({});
    await adminSvc.getOrder(currentOrder.id);
    await adminSvc.listProducts({});
    expect((await adminSvc.getProduct('prod-1')).id).toBe('prod-1');
    await expect(adminSvc.getProduct('missing')).rejects.toMatchObject({ status: 404 });

    const created = await adminSvc.createOrder({
      data: { items: [{ productId: 'prod-1', quantity: 1 }], shippingAddress: SAMPLE_ADDRESS },
      actorId: 'admin-1',
      requestId: 'req-1',
    });
    expect(created.status).toBe('PENDING_PAYMENT');

    const updatedPaid = await adminSvc.updateOrder({
      orderId: currentOrder.id,
      data: { status: 'PAID', shippingAddress: SAMPLE_ADDRESS, version: 1 },
      actorId: 'admin-1',
      requestId: 'req-2',
    });
    expect(updatedPaid.status).toBe('PAID');

    await adminSvc.deleteOrder({
      orderId: currentOrder.id,
      version: updatedPaid.version,
      actorId: 'admin-1',
      requestId: 'req-3',
    });
    expect(prisma.order.delete).toHaveBeenCalledWith({ where: { id: currentOrder.id } });
  });
});

describe('Unit: AuthMailWorker & ChatService edge cases', () => {
  it('AuthMailWorker handles missing payload, expired token, retry, and permanent failure', async () => {
    expect(sanitizeMailErrorCode({ code: 'ECONNREFUSED!' })).toBe('ECONNREFUSED_');

    const mailMasterKey = crypto.randomBytes(32);
    const expiredId = '33333333-3333-4333-8333-333333333331';
    const retryId = '33333333-3333-4333-8333-333333333332';
    const failId = '33333333-3333-4333-8333-333333333333';

    const makeEncrypted = (rowId, payload) =>
      encryptEnvelope(
        payload,
        { entity: 'AuthMailOutbox', rowId, field: 'encryptedPayload' },
        { masterKey: mailMasterKey }
      );

    const now = new Date('2026-11-23T12:00:00Z');
    const items = [
      { id: '33333333-3333-4333-8333-333333333330', template: 'VERIFY_EMAIL', attempts: 0, encryptedPayload: null },
      {
        id: expiredId,
        template: 'VERIFY_EMAIL',
        attempts: 0,
        encryptedPayload: makeEncrypted(expiredId, {
          email: 'a@example.com',
          token: 'A'.repeat(43),
          expiresAt: new Date(now.getTime() - 1000).toISOString(),
        }),
      },
      {
        id: retryId,
        template: 'VERIFY_EMAIL',
        attempts: 0,
        dedupeKey: 'dk-retry',
        encryptedPayload: makeEncrypted(retryId, {
          email: 'b@example.com',
          token: 'B'.repeat(43),
          expiresAt: new Date(now.getTime() + 600_000).toISOString(),
        }),
      },
      {
        id: failId,
        template: 'VERIFY_EMAIL',
        attempts: 4,
        dedupeKey: 'dk-fail',
        encryptedPayload: makeEncrypted(failId, {
          email: 'c@example.com',
          token: 'C'.repeat(43),
          expiresAt: new Date(now.getTime() + 600_000).toISOString(),
        }),
      },
    ];

    const authRepository = {
      claimDueMailOutboxItems: jest.fn(async () => items),
      markMailOutboxFailed: jest.fn(async () => ({})),
      markMailOutboxSent: jest.fn(async () => ({})),
      scheduleMailOutboxRetry: jest.fn(async () => ({})),
      recordSecurityAuditEvent: jest.fn(async () => ({})),
      purgeAuthLifecycleRecords: jest.fn(async () => ({ deleted: 2 })),
    };
    const mailAdapter = {
      sendMail: jest.fn(async () => {
        throw Object.assign(new Error('SMTP down'), { code: 'ETIMEDOUT' });
      }),
    };

    const worker = new AuthMailWorker({
      authRepository,
      mailAdapter,
      mailEncryption: { masterKey: mailMasterKey },
      mailConfig: { from: 'no-reply@test.local', maxAttempts: 5 },
      appOrigin: 'http://localhost:5174',
    });

    const summary = await worker.processDueBatch({ now });
    expect(summary).toEqual({ claimed: 4, sent: 0, retried: 1, failed: 2, expired: 1 });
    expect(await worker.purgeExpiredRecords({ now })).toEqual({ deleted: 2 });
  });

  it('ChatService enforces in-flight concurrency limits and handles empty/redacted messages', async () => {
    const chat = new ChatService({
      knowledgeRepository: { searchApprovedChunks: jest.fn(async () => []) },
      llmClient: { isConfigured: () => false },
    });

    // Purely sensitive/redacted message escalates cleanly
    const res = await chat.answerMessage({ message: 'a', ipKey: '127.0.0.1' });
    expect(res.escalated).toBe(true);

    // Concurrency limit per IP -> 429 RATE_LIMITED
    chat.acquireInFlight('10.0.0.1');
    chat.acquireInFlight('10.0.0.1');
    expect(() => chat.acquireInFlight('10.0.0.1')).toThrow(AppError);
    chat.releaseInFlight('10.0.0.1');
    chat.releaseInFlight('10.0.0.1');
  });
});
