process.env.NODE_ENV = 'test';

const crypto = require('crypto');
const request = require('supertest');
const Stripe = require('stripe');

const { createApp } = require('../../src/app');
const { config } = require('../../src/config/env');
const { signSessionJwt, sha256Hex } = require('../../src/config/crypto');
const { StripeClient } = require('../../src/integrations/stripe/stripe.client');
const { NO_EVIDENCE_ANSWER } = require('../../src/integrations/llm/llm.client');
const { createInMemoryPrisma } = require('./inMemoryPrisma');

const ORIGIN = config.appOrigin;
const CAT_ID = '10000000-0000-4000-8000-000000000001';
const PROD_1_ID = '20000000-0000-4000-8000-000000000001';
const PROD_INACTIVE_ID = '20000000-0000-4000-8000-000000000009';
const WEBHOOK_SECRET = 'whsec_test_integration_secret';

const VALID_ADDRESS = {
  fullName: 'Alice Shopper',
  line1: '456 Market Street',
  city: 'San Francisco',
  region: 'CA',
  postalCode: '94105',
  country: 'US',
  phone: '+14155551234',
};

function setupTestContext(overrides = {}) {
  const prisma = createInMemoryPrisma();

  // Seed categories & products
  prisma._db.category.push({
    id: CAT_ID,
    name: 'Electronics',
    slug: 'electronics',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  prisma._db.product.push(
    {
      id: PROD_1_ID,
      categoryId: CAT_ID,
      sku: 'ELEC-001',
      name: 'Studio Headphones',
      description: 'Wireless ANC headphones',
      price: 15000,
      currency: 'USD',
      imageUrl: null,
      stockOnHand: 5,
      stockReserved: 0,
      active: true,
      version: 1,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    },
    {
      id: PROD_INACTIVE_ID,
      categoryId: CAT_ID,
      sku: 'ELEC-ARCHIVED',
      name: 'Discontinued Speaker',
      description: 'No longer sold',
      price: 9900,
      currency: 'USD',
      imageUrl: null,
      stockOnHand: 10,
      stockReserved: 0,
      active: false,
      version: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }
  );

  const stripeClient = new StripeClient({
    secretKey: 'sk_test_integration_dummy',
    webhookSecret: WEBHOOK_SECRET,
  });
  stripeClient.createCheckoutSession = jest.fn(async ({ order, expiresAtUnix }) => ({
    id: `cs_test_${order.id.slice(0, 8)}`,
    url: `https://checkout.stripe.com/c/pay/cs_test_${order.id.slice(0, 8)}`,
    expiresAt: new Date(expiresAtUnix * 1000),
    paymentStatus: 'unpaid',
    status: 'open',
  }));
  stripeClient.retrieveCheckoutSession = jest.fn(async (sessionId) => ({
    id: sessionId,
    url: `https://checkout.stripe.com/c/pay/${sessionId}`,
    expires_at: Math.floor(Date.now() / 1000) + 1800,
    payment_status: 'unpaid',
    status: 'open',
  }));
  stripeClient.expireCheckoutSession = jest.fn(async (sessionId) => ({
    id: sessionId,
    status: 'expired',
  }));

  const { app, services } = createApp({
    prisma,
    stripeClient,
    ...overrides,
  });

  function createSessionCookieForUser({ role = 'CUSTOMER', mfaVerified = false, ageMs = 0 } = {}) {
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const csrfToken = 'test-csrf-token-value-1234567890abcdef';
    const createdAt = new Date(Date.now() - ageMs);
    const expiresAt = new Date(createdAt.getTime() + 15 * 60 * 1000);

    prisma._db.user.push({
      id: userId,
      googleSubject: `sub-${userId}`,
      email: `${role.toLowerCase()}-${userId.slice(0, 6)}@example.com`,
      displayName: role === 'ADMIN' ? 'Admin User' : 'Customer User',
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma._db.authSession.push({
      id: sessionId,
      userId,
      csrfTokenHash: sha256Hex(csrfToken),
      expiresAt,
      revokedAt: null,
      createdAt,
      mfaVerified,
    });

    const jwtToken = signSessionJwt({ userId, sessionId });
    return {
      userId,
      sessionId,
      csrfToken,
      cookie: `${config.cookies.sessionName}=${jwtToken}`,
    };
  }

  return { app, prisma, services, stripeClient, createSessionCookieForUser };
}

describe('Integration: E-Commerce API v1', () => {
  describe('Health, Security Headers & OpenAPI', () => {
    it('returns 200 for live and ready probes and sets security headers', async () => {
      const { app } = setupTestContext();
      const liveRes = await request(app).get('/api/v1/health/live');
      expect(liveRes.status).toBe(200);
      expect(liveRes.body).toEqual({ status: 'ok' });
      expect(liveRes.headers['x-request-id']).toBeDefined();
      expect(liveRes.headers['x-content-type-options']).toBe('nosniff');
      expect(liveRes.headers['x-frame-options']).toBe('DENY');
      expect(liveRes.headers['cache-control']).toBe('no-store');

      const readyRes = await request(app).get('/api/v1/health/ready');
      expect(readyRes.status).toBe(200);
      expect(readyRes.body).toEqual({ status: 'ready' });
    });

    it('returns 405 Method Not Allowed with Allow header on unsupported verb', async () => {
      const { app } = setupTestContext();
      const res = await request(app).delete('/api/v1/categories');
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET');
      expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
    });
  });

  describe('Catalog & Categories', () => {
    it('lists active products only, supports search/filtering, and rejects invalid queries', async () => {
      const { app } = setupTestContext();

      const catRes = await request(app).get('/api/v1/categories');
      expect(catRes.status).toBe(200);
      expect(catRes.body.data).toHaveLength(1);
      expect(catRes.body.data[0].slug).toBe('electronics');

      const listRes = await request(app).get('/api/v1/products?q=Headphones&minPrice=10000&maxPrice=20000&inStock=true');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(1);
      expect(listRes.body.data[0].id).toBe(PROD_1_ID);
      expect(listRes.body.data[0].availableQuantity).toBe(5);
      expect(listRes.body.pagination.totalItems).toBe(1);

      // Inactive product returns 404 on public route
      const inactiveRes = await request(app).get(`/api/v1/products/${PROD_INACTIVE_ID}`);
      expect(inactiveRes.status).toBe(404);

      // Reversed price range returns 400
      const badRange = await request(app).get('/api/v1/products?minPrice=20000&maxPrice=10000');
      expect(badRange.status).toBe(400);
      expect(badRange.body.error.code).toBe('VALIDATION_ERROR');

      // Duplicate query param rejected
      const dupQuery = await request(app).get('/api/v1/products?page=1&page=2');
      expect(dupQuery.status).toBe(400);
    });
  });

  describe('Auth Session, CSRF Rotation & Logout', () => {
    it('rotates CSRF on GET /auth/session and revokes session on POST /auth/logout', async () => {
      const { app, createSessionCookieForUser } = setupTestContext();
      const user = createSessionCookieForUser({ role: 'CUSTOMER' });

      const sessRes = await request(app).get('/api/v1/auth/session').set('Cookie', user.cookie);
      expect(sessRes.status).toBe(200);
      expect(sessRes.body.user.id).toBe(user.userId);
      const rotatedCsrf = sessRes.body.csrfToken;
      expect(rotatedCsrf).not.toBe(user.csrfToken);

      // Old CSRF token fails
      const badCsrf = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', user.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', user.csrfToken)
        .send({});
      expect(badCsrf.status).toBe(403);
      expect(badCsrf.body.error.code).toBe('CSRF_INVALID');

      // Rotated CSRF succeeds
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', user.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', rotatedCsrf)
        .send({});
      expect(logoutRes.status).toBe(204);

      // Session is now revoked
      const afterLogout = await request(app).get('/api/v1/auth/session').set('Cookie', user.cookie);
      expect(afterLogout.status).toBe(401);
    });
  });

  describe('Cart, Order Reservation, Idempotency, Checkout & Webhook Settlement', () => {
    it('executes full purchase lifecycle atomically and settles via signed Stripe webhook', async () => {
      const { app, prisma, services, createSessionCookieForUser } = setupTestContext();
      const customer = createSessionCookieForUser({ role: 'CUSTOMER' });
      const otherCustomer = createSessionCookieForUser({ role: 'CUSTOMER' });

      // 1. Get empty cart lazily
      const cartRes = await request(app).get('/api/v1/cart').set('Cookie', customer.cookie);
      expect(cartRes.status).toBe(200);
      expect(cartRes.body.data.version).toBe(1);
      expect(cartRes.body.data.items).toHaveLength(0);

      // 2. Add 2 units to cart
      const addRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .send({ productId: PROD_1_ID, quantity: 2, cartVersion: 1 });
      expect(addRes.status).toBe(200);
      expect(addRes.body.data.version).toBe(2);
      expect(addRes.body.data.grandTotal).toBe(30000);

      // 3. Stale cartVersion returns 409 VERSION_CONFLICT
      const conflictRes = await request(app)
        .patch(`/api/v1/cart/items/${PROD_1_ID}`)
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .send({ quantity: 3, cartVersion: 1 });
      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error.code).toBe('VERSION_CONFLICT');

      // 4. Create Order with Idempotency-Key
      const idempKey = 'order_create_key_1234567890';
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .set('Idempotency-Key', idempKey)
        .send({ cartVersion: 2, shippingAddress: VALID_ADDRESS });
      expect(orderRes.status).toBe(201);
      const orderId = orderRes.body.data.id;
      expect(orderRes.headers.location).toBe(`/api/v1/orders/${orderId}`);
      expect(orderRes.body.data.status).toBe('PENDING_PAYMENT');
      expect(orderRes.body.data.grandTotal).toBe(30000);

      // Stock is now reserved (stockOnHand=5, stockReserved=2 -> available=3)
      const prodAfterReserve = await request(app).get(`/api/v1/products/${PROD_1_ID}`);
      expect(prodAfterReserve.body.data.availableQuantity).toBe(3);

      // 5. Idempotent replay with same key & body returns exact same 201
      const replayRes = await request(app)
        .post('/api/v1/orders')
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .set('Idempotency-Key', idempKey)
        .send({ cartVersion: 2, shippingAddress: VALID_ADDRESS });
      expect(replayRes.status).toBe(201);
      expect(replayRes.body.data.id).toBe(orderId);

      // 6. IDOR check: another customer gets 404
      const idorRes = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Cookie', otherCustomer.cookie);
      expect(idorRes.status).toBe(404);

      // 7. Create Stripe Checkout session
      const checkoutRes = await request(app)
        .post('/api/v1/checkout/sessions')
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .set('Idempotency-Key', 'checkout_key_1234567890')
        .send({ orderId });
      expect(checkoutRes.status).toBe(201);
      const sessionId = checkoutRes.body.data.sessionId;
      expect(checkoutRes.body.data.checkoutUrl).toContain('https://checkout.stripe.com/');

      // 8. Signed Stripe webhook delivery (checkout.session.completed)
      const stripeSdk = new Stripe('sk_test_dummy');
      const webhookPayload = JSON.stringify({
        id: 'evt_test_paid_1',
        type: 'checkout.session.completed',
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: sessionId,
            mode: 'payment',
            payment_status: 'paid',
            amount_total: 30000,
            currency: 'usd',
            payment_intent: 'pi_test_123',
            metadata: { orderId },
          },
        },
      });
      const sig = stripeSdk.webhooks.generateTestHeaderString({
        payload: webhookPayload,
        secret: WEBHOOK_SECRET,
      });

      const whRes = await request(app)
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', sig)
        .send(webhookPayload);
      expect(whRes.status).toBe(200);
      expect(whRes.body).toEqual({ received: true });

      // Worker processes durable inbox event
      await services.paymentsService.reconcilePendingWork();

      // Order is now PAID, stockOnHand=3, stockReserved=0, cart cleared
      const paidOrder = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Cookie', customer.cookie);
      expect(paidOrder.status).toBe(200);
      expect(paidOrder.body.data.status).toBe('PAID');
      expect(paidOrder.body.data.paidAt).not.toBeNull();

      const productRow = prisma._db.product.find((p) => p.id === PROD_1_ID);
      expect(productRow.stockOnHand).toBe(3);
      expect(productRow.stockReserved).toBe(0);

      const cartAfterPay = await request(app).get('/api/v1/cart').set('Cookie', customer.cookie);
      expect(cartAfterPay.body.data.items).toHaveLength(0);

      // Cannot cancel a PAID order
      const cancelPaid = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .send({});
      expect(cancelPaid.status).toBe(409);
      expect(cancelPaid.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    });
  });

  describe('Admin RBAC, MFA/Recent-Auth & Product/Order Management', () => {
    it('enforces admin role, MFA, recent-auth, stock floor, and order transitions with audit trail', async () => {
      const { app, prisma, createSessionCookieForUser } = setupTestContext();
      const customer = createSessionCookieForUser({ role: 'CUSTOMER' });
      const adminNoMfa = createSessionCookieForUser({ role: 'ADMIN', mfaVerified: false });
      const adminStale = createSessionCookieForUser({
        role: 'ADMIN',
        mfaVerified: true,
        ageMs: 6 * 60 * 1000,
      });
      const adminFresh = createSessionCookieForUser({
        role: 'ADMIN',
        mfaVerified: true,
        ageMs: 1000,
      });

      // Customer denied 403
      const custRes = await request(app).get('/api/v1/admin/products').set('Cookie', customer.cookie);
      expect(custRes.status).toBe(403);

      // Admin without MFA denied 403
      const noMfaRes = await request(app)
        .get('/api/v1/admin/products')
        .set('Cookie', adminNoMfa.cookie);
      expect(noMfaRes.status).toBe(403);

      // Admin with stale session (>5min) denied 403 on mutation
      const staleRes = await request(app)
        .post('/api/v1/admin/products')
        .set('Cookie', adminStale.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', adminStale.csrfToken)
        .send({
          sku: 'NEW-SKU-1',
          name: 'USB-C Hub',
          description: '7-in-1 hub',
          categoryId: CAT_ID,
          price: 4500,
          imageUrl: null,
          stockOnHand: 10,
          active: true,
        });
      expect(staleRes.status).toBe(403);

      // Fresh MFA Admin creates product
      const createRes = await request(app)
        .post('/api/v1/admin/products')
        .set('Cookie', adminFresh.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', adminFresh.csrfToken)
        .send({
          sku: 'NEW-SKU-1',
          name: 'USB-C Hub',
          description: '7-in-1 hub',
          categoryId: CAT_ID,
          price: 4500,
          imageUrl: null,
          stockOnHand: 10,
          active: true,
        });
      expect(createRes.status).toBe(201);
      const newProdId = createRes.body.data.id;
      expect(prisma._db.auditLog).toHaveLength(1);
      expect(prisma._db.auditLog[0].action).toBe('CREATE_PRODUCT');

      // Soft archive product
      const delRes = await request(app)
        .delete(`/api/v1/admin/products/${newProdId}`)
        .set('Cookie', adminFresh.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', adminFresh.csrfToken)
        .send({ version: 1 });
      expect(delRes.status).toBe(204);
      expect(prisma._db.product.find((p) => p.id === newProdId).active).toBe(false);

      // Admin list & get & update products
      const listProdRes = await request(app)
        .get('/api/v1/admin/products?active=false')
        .set('Cookie', adminFresh.cookie);
      expect(listProdRes.status).toBe(200);

      const getProdRes = await request(app)
        .get(`/api/v1/admin/products/${PROD_1_ID}`)
        .set('Cookie', adminFresh.cookie);
      expect(getProdRes.status).toBe(200);

      const patchProdRes = await request(app)
        .patch(`/api/v1/admin/products/${PROD_1_ID}`)
        .set('Cookie', adminFresh.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', adminFresh.csrfToken)
        .send({ name: 'Mechanical Keyboard Pro', version: 1 });
      expect(patchProdRes.status).toBe(200);
      expect(patchProdRes.body.data.name).toBe('Mechanical Keyboard Pro');

      // Admin Order CRUD: create -> list -> get -> update -> delete
      const createAdminOrderRes = await request(app)
        .post('/api/v1/admin/orders')
        .set('Cookie', adminFresh.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', adminFresh.csrfToken)
        .send({
          items: [{ productId: PROD_1_ID, quantity: 1 }],
          shippingAddress: {
            fullName: 'Admin Order Customer',
            line1: '500 Admin Way',
            city: 'Austin',
            region: 'TX',
            postalCode: '78701',
            country: 'US',
          },
        });
      expect(createAdminOrderRes.status).toBe(201);
      const adminOrderId = createAdminOrderRes.body.data.id;

      const listAdminOrdersRes = await request(app)
        .get('/api/v1/admin/orders?status=PENDING_PAYMENT')
        .set('Cookie', adminFresh.cookie);
      expect(listAdminOrdersRes.status).toBe(200);
      expect(listAdminOrdersRes.body.data.some((o) => o.id === adminOrderId)).toBe(true);

      const getAdminOrderRes = await request(app)
        .get(`/api/v1/admin/orders/${adminOrderId}`)
        .set('Cookie', adminFresh.cookie);
      expect(getAdminOrderRes.status).toBe(200);

      const patchAdminOrderRes = await request(app)
        .patch(`/api/v1/admin/orders/${adminOrderId}`)
        .set('Cookie', adminFresh.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', adminFresh.csrfToken)
        .send({ status: 'PAID', version: 1 });
      expect(patchAdminOrderRes.status).toBe(200);
      expect(patchAdminOrderRes.body.data.status).toBe('PAID');

      const advanceRes = await request(app)
        .patch(`/api/v1/admin/orders/${adminOrderId}/status`)
        .set('Cookie', adminFresh.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', adminFresh.csrfToken)
        .send({ status: 'PROCESSING', version: patchAdminOrderRes.body.data.version });
      expect(advanceRes.status).toBe(200);
      expect(advanceRes.body.data.status).toBe('PROCESSING');

      const deleteAdminOrderRes = await request(app)
        .delete(`/api/v1/admin/orders/${adminOrderId}`)
        .set('Cookie', adminFresh.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', adminFresh.csrfToken)
        .send({ version: advanceRes.body.data.version });
      expect(deleteAdminOrderRes.status).toBe(204);
    });
  });

  describe('Cart Mutations, Customer Order List/Cancel/Delete & Webhook Expiry', () => {
    it('supports cart update/remove, order listing, immediate cancel, and customer order deletion', async () => {
      const { app, createSessionCookieForUser } = setupTestContext();
      const customer = createSessionCookieForUser({ role: 'CUSTOMER' });
      const otherCustomer = createSessionCookieForUser({ role: 'CUSTOMER' });

      // Add -> Update -> Remove -> Re-add
      const addRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .send({ productId: PROD_1_ID, quantity: 1, cartVersion: 1 });
      expect(addRes.status).toBe(200);

      const patchRes = await request(app)
        .patch(`/api/v1/cart/items/${PROD_1_ID}`)
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .send({ quantity: 2, cartVersion: addRes.body.data.version });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.items[0].quantity).toBe(2);

      const removeRes = await request(app)
        .delete(`/api/v1/cart/items/${PROD_1_ID}`)
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .send({ cartVersion: patchRes.body.data.version });
      expect(removeRes.status).toBe(200);
      expect(removeRes.body.data.items).toHaveLength(0);

      // Re-add and create order
      const reAdd = await request(app)
        .post('/api/v1/cart/items')
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .send({ productId: PROD_1_ID, quantity: 1, cartVersion: removeRes.body.data.version });

      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .set('Idempotency-Key', 'order-del-test-1')
        .send({
          cartVersion: reAdd.body.data.version,
          shippingAddress: {
            fullName: 'Alex Tester',
            line1: '101 Pine St',
            city: 'Seattle',
            region: 'WA',
            postalCode: '98101',
            country: 'US',
          },
        });
      expect(orderRes.status).toBe(201);
      const orderId = orderRes.body.data.id;

      // List orders with valid status filter & invalid query
      const listRes = await request(app)
        .get('/api/v1/orders?page=1&pageSize=10&status=PENDING_PAYMENT')
        .set('Cookie', customer.cookie);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(1);

      const badListRes = await request(app)
        .get('/api/v1/orders?status=INVALID&bogus=1')
        .set('Cookie', customer.cookie);
      expect(badListRes.status).toBe(400);

      // Immediate cancel on NOT_STARTED order
      const cancelRes = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken)
        .send({});
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.order.status).toBe('CANCELLED');

      // Other user cannot delete someone else's order
      const otherDelRes = await request(app)
        .delete(`/api/v1/orders/${orderId}`)
        .set('Cookie', otherCustomer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', otherCustomer.csrfToken);
      expect(otherDelRes.status).toBe(404);

      // Owner deletes order -> 204, then GET -> 404
      const delOrderRes = await request(app)
        .delete(`/api/v1/orders/${orderId}`)
        .set('Cookie', customer.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', customer.csrfToken);
      expect(delOrderRes.status).toBe(204);

      const afterDelGet = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Cookie', customer.cookie);
      expect(afterDelGet.status).toBe(404);
    });
  });

  describe('AI Support Grounding & Safety Controls', () => {
    it('requires allowed Origin and returns deterministic escalation when only DRAFT docs exist', async () => {
      const { app, prisma } = setupTestContext();

      // Seed a DRAFT document (must be excluded!)
      const draftDocId = crypto.randomUUID();
      prisma._db.knowledgeDocument.push({
        id: draftDocId,
        documentId: 'return-policy',
        title: 'Return Policy',
        version: '0.1-draft',
        status: 'DRAFT',
        owner: 'Unassigned',
        approvedAt: null,
        sourcePath: 'docs/ai-knowledge/return-policy.md',
        contentHash: 'abc',
      });
      prisma._db.knowledgeChunk.push({
        id: crypto.randomUUID(),
        documentVersionId: draftDocId,
        section: 'Returns',
        ordinal: 0,
        content: 'Draft return policy text.',
      });

      // Missing Origin -> 403 ORIGIN_FORBIDDEN
      const noOrigin = await request(app)
        .post('/api/v1/support/messages')
        .send({ message: 'What is the return policy?' });
      expect(noOrigin.status).toBe(403);
      expect(noOrigin.body.error.code).toBe('ORIGIN_FORBIDDEN');

      // With Origin -> safe deterministic escalation because no APPROVED docs exist
      const res = await request(app)
        .post('/api/v1/support/messages')
        .set('Origin', ORIGIN)
        .send({ message: 'What is the return policy?' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        answer: NO_EVIDENCE_ANSWER,
        citations: [],
        escalated: true,
      });
    });

    it('returns verified server citations when APPROVED document & grounded LLM answer match', async () => {
      const approvedDocId = crypto.randomUUID();
      const approvedChunkId = crypto.randomUUID();

      const mockLlmClient = {
        isConfigured: () => true,
        generateGroundedAnswer: jest.fn(async () => ({
          answer: 'Sign in with Google creates a customer account on first verified login.',
          citationIds: [approvedChunkId],
        })),
      };

      const { app, prisma } = setupTestContext({ llmClient: mockLlmClient });

      prisma._db.knowledgeDocument.push({
        id: approvedDocId,
        documentId: 'faq',
        title: 'Frequently Asked Questions',
        version: '1.0',
        status: 'APPROVED',
        owner: 'Store Owner',
        approvedAt: new Date(),
        sourcePath: 'docs/ai-knowledge/faq.md',
        contentHash: 'hash123',
      });
      prisma._db.knowledgeChunk.push({
        id: approvedChunkId,
        documentVersionId: approvedDocId,
        section: 'How do I sign in?',
        ordinal: 0,
        content: 'Use Sign in with Google. A first successful verified sign-in creates a customer account.',
      });

      const res = await request(app)
        .post('/api/v1/support/messages')
        .set('Origin', ORIGIN)
        .send({ message: 'How do I sign in with Google?' });

      expect(res.status).toBe(200);
      expect(res.body.data.escalated).toBe(false);
      expect(res.body.data.citations).toEqual([
        {
          documentId: 'faq',
          title: 'Frequently Asked Questions',
          version: '1.0',
          section: 'How do I sign in?',
        },
      ]);
    });
  });
});
