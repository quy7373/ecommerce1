const EventEmitter = require('events');
const crypto = require('crypto');
const { AuthRepository } = require('../../src/modules/auth/auth.repository');
const { PaymentsService } = require('../../src/modules/payments/payments.service');
const { OrdersService } = require('../../src/modules/orders/orders.service');
const { IdempotencyService } = require('../../src/modules/orders/idempotency.service');
const { ChatService } = require('../../src/modules/chat/chat.service');
const {
  strictJsonBodyMiddleware,
  rejectDuplicateQueryParams,
} = require('../../src/middleware/jsonParser');
const { createAuthMiddleware } = require('../../src/middleware/auth');
const { AppError } = require('../../src/config/errors');
const { signSessionJwt, sha256Hex, encryptEnvelope } = require('../../src/config/crypto');

describe('Deep Coverage: AuthRepository (PostgreSQL lock paths, OAuth, Direct Signup, Purge)', () => {
  it('covers advisory locks, row locks, OAuth attempts, user creation, and lifecycle purge', async () => {
    const attempt = {
      id: 'att-1',
      stateHash: 'sh-1',
      browserBindingHash: 'bb-1',
      nonceHash: 'nh-1',
      encryptedCodeVerifier: '{}',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    };

    const prisma = {
      $executeRaw: jest.fn(async () => 1),
      $queryRaw: jest.fn(async () => []),
      $transaction: async (fn) => fn(prisma),
      authActionToken: {
        findUnique: jest.fn(async () => ({ id: 'tok-1' })),
        deleteMany: jest.fn(async () => ({ count: 3 })),
      },
      passwordCredential: {
        findUnique: jest.fn(async () => ({ userId: 'u1' })),
        create: jest.fn(async ({ data }) => data),
      },
      oAuthAttempt: {
        create: jest.fn(async ({ data }) => data),
        findUnique: jest.fn(async () => attempt),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      user: {
        findUnique: jest.fn(async () => ({ id: 'u1', email: 'a@b.com' })),
        create: jest.fn(async ({ data }) => data),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      securityAuditOutbox: {
        create: jest.fn(async () => ({})),
      },
      authMailOutbox: {
        updateMany: jest.fn(async () => ({ count: 2 })),
        deleteMany: jest.fn(async () => ({ count: 4 })),
      },
    };

    const repo = new AuthRepository(prisma);
    await repo._acquireEmailAdvisoryLock(prisma, 'a@b.com');
    await repo._lockActionTokenByHash(prisma, 'hash-1');
    await repo._lockPasswordCredentialByUserId(prisma, 'u1');
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);

    await repo.createOAuthAttempt({
      stateHash: 'sh-1',
      browserBindingHash: 'bb-1',
      nonceHash: 'nh-1',
      encryptedCodeVerifier: '{}',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const consumed = await repo.consumeOAuthAttempt({ stateHash: 'sh-1' });
    expect(consumed.id).toBe('att-1');

    // Race condition count !== 1 returns null
    prisma.oAuthAttempt.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await repo.consumeOAuthAttempt({ stateHash: 'sh-1' })).toBeNull();

    // Expired attempt returns null
    prisma.oAuthAttempt.findUnique.mockResolvedValueOnce({
      ...attempt,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await repo.consumeOAuthAttempt({ stateHash: 'sh-1' })).toBeNull();

    expect((await repo.findUserByGoogleSubject('sub-1')).id).toBe('u1');
    expect((await repo.findUserByEmail('a@b.com')).id).toBe('u1');

    const created = await repo.createCustomerUser({ email: 'new@b.com', displayName: 'New' });
    expect(created.email).toBe('new@b.com');

    const verified = await repo.createVerifiedPasswordUser({
      email: 'direct@b.com',
      displayName: 'Direct',
      passwordHash: 'hash',
      requestId: 'req-1',
    });
    expect(verified.email).toBe('direct@b.com');

    await repo.markUserEmailVerified('u1');

    const purged = await repo.purgeAuthLifecycleRecords();
    expect(purged).toEqual({ deletedTokens: 3, purgedPayloads: 2, deletedOutbox: 4 });
  });
});

describe('Deep Coverage: PaymentsService (webhooks, checkout guards, settlement)', () => {
  it('covers ingestWebhookEvent, processWebhookEvent all branches, and createCheckoutSession guards', async () => {
    const orderId = '99999999-9999-4999-8999-999999999991';
    let currentOrder = {
      id: orderId,
      userId: 'u1',
      status: 'PAID',
      checkoutState: 'READY',
      stripeSessionId: 'cs_1',
      grandTotal: 5000,
      version: 1,
      reservationExpiresAt: new Date(Date.now() + 60_000),
      items: [],
      reservations: [],
    };
    let currentEvent = null;

    const prisma = {
      $transaction: async (fn) => fn(prisma),
      webhookEvent: {
        create: jest.fn(async ({ data }) => data),
        findUnique: jest.fn(async () => currentEvent),
        update: jest.fn(async ({ data }) => ({ ...currentEvent, ...data })),
      },
      order: {
        findFirst: jest.fn(async () => currentOrder),
        findUnique: jest.fn(async () => currentOrder),
        update: jest.fn(async ({ data }) => {
          currentOrder = { ...currentOrder, ...data };
          return currentOrder;
        }),
      },
    };
    const ordersService = {
      releaseReservationsAndCancelOrder: jest.fn(async () => ({})),
    };
    const stripeClient = {
      verifyWebhookEvent: jest.fn((raw) => JSON.parse(raw)),
      projectWebhookEvent: jest.fn((evt) => ({
        sessionId: evt.data.object.id,
        orderId: evt.data.object.metadata?.orderId || null,
      })),
      retrieveCheckoutSession: jest.fn(async () => ({
        id: 'cs_1',
        status: 'open',
        url: 'https://checkout.stripe.com/c/pay/cs_1',
        expires_at: Math.floor(Date.now() / 1000) + 1200,
      })),
    };
    const svc = new PaymentsService(prisma, {
      stripeClient,
      ordersService,
      idempotencyService: { execute: async ({ handler }) => handler() },
    });

    // ingestStripeWebhook duplicate P2002 & DB error 503 & existing event
    prisma.webhookEvent.findUnique.mockResolvedValueOnce({ id: 'existing-evt' });
    expect(
      await svc.ingestStripeWebhook({
        rawBody: JSON.stringify({
          id: 'evt_seen',
          type: 'checkout.session.completed',
          livemode: false,
          data: { object: { id: 'cs_1', metadata: { orderId } } },
        }),
        signatureHeader: 'sig',
      })
    ).toEqual({ received: true, duplicate: true, eventId: 'existing-evt' });

    prisma.webhookEvent.findUnique.mockResolvedValueOnce(null);
    prisma.webhookEvent.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    expect(
      await svc.ingestStripeWebhook({
        rawBody: JSON.stringify({
          id: 'evt_dup',
          type: 'checkout.session.completed',
          livemode: false,
          data: { object: { id: 'cs_1', metadata: { orderId } } },
        }),
        signatureHeader: 'sig',
      })
    ).toEqual({ received: true, duplicate: true });

    prisma.webhookEvent.findUnique.mockResolvedValueOnce(null);
    prisma.webhookEvent.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      svc.ingestStripeWebhook({
        rawBody: JSON.stringify({
          id: 'evt_err',
          type: 'checkout.session.completed',
          livemode: false,
          data: { object: { id: 'cs_1', metadata: { orderId } } },
        }),
        signatureHeader: 'sig',
      })
    ).rejects.toMatchObject({ status: 503 });

    // processWebhookEvent: NOT_FOUND / PROCESSED / unsupported / missing orderId / order not found
    currentEvent = null;
    expect(await svc.processWebhookEvent('e0')).toEqual({ status: 'NOT_FOUND' });

    currentEvent = { id: 'e1', type: 'charge.succeeded', status: 'RECEIVED', payload: {} };
    expect(await svc.processWebhookEvent('e1')).toEqual({ status: 'PROCESSED' });

    currentEvent = { id: 'e2', type: 'checkout.session.completed', status: 'RECEIVED', orderId: null, payload: {} };
    expect(await svc.processWebhookEvent('e2')).toEqual({ status: 'REVIEW' });

    currentEvent = { id: 'e3', type: 'checkout.session.completed', status: 'RECEIVED', orderId: 'missing', payload: {} };
    prisma.order.findUnique.mockResolvedValueOnce(null);
    expect(await svc.processWebhookEvent('e3')).toEqual({ status: 'REVIEW' });

    // Semantic mismatch -> PAYMENT_REVIEW
    currentOrder = { ...currentOrder, status: 'PENDING_PAYMENT', grandTotal: 5000 };
    currentEvent = {
      id: 'e4',
      type: 'checkout.session.completed',
      status: 'RECEIVED',
      orderId,
      payload: { livemode: false, mode: 'payment', currency: 'usd', paymentStatus: 'paid', amountTotal: 9999, sessionId: 'cs_1' },
    };
    expect(await svc.processWebhookEvent('e4')).toEqual({ status: 'REVIEW' });
    expect(currentOrder.status).toBe('PAYMENT_REVIEW');

    // Already PAID -> idempotent PROCESSED
    currentOrder = { ...currentOrder, status: 'PAID', grandTotal: 5000 };
    currentEvent = {
      id: 'e5',
      type: 'checkout.session.completed',
      status: 'RECEIVED',
      orderId,
      payload: { livemode: false, mode: 'payment', currency: 'usd', paymentStatus: 'paid', amountTotal: 5000, sessionId: 'cs_1' },
    };
    expect(await svc.processWebhookEvent('e5')).toEqual({ status: 'PROCESSED' });

    // Late paid after CANCELLED -> PAYMENT_REVIEW
    currentOrder = { ...currentOrder, status: 'CANCELLED', grandTotal: 5000 };
    expect(await svc.processWebhookEvent('e5')).toEqual({ status: 'REVIEW' });
    expect(currentOrder.status).toBe('PAYMENT_REVIEW');

    // checkout.session.expired -> releases reservations
    currentOrder = { ...currentOrder, status: 'PENDING_PAYMENT', grandTotal: 5000 };
    currentEvent = {
      id: 'e6',
      type: 'checkout.session.expired',
      status: 'RECEIVED',
      orderId,
      payload: { sessionId: 'cs_1' },
    };
    expect(await svc.processWebhookEvent('e6')).toEqual({ status: 'PROCESSED' });
    expect(ordersService.releaseReservationsAndCancelOrder).toHaveBeenCalled();

    // createCheckoutSession: wrong status -> 409, expired reservation -> 409, READY reuse -> 200
    currentOrder = { ...currentOrder, status: 'PAID' };
    await expect(
      svc.createCheckoutSession({ userId: 'u1', orderId, idempotencyKey: 'ik-1' })
    ).rejects.toMatchObject({ status: 409 });

    currentOrder = {
      ...currentOrder,
      status: 'PENDING_PAYMENT',
      reservationExpiresAt: new Date(Date.now() - 10_000),
    };
    await expect(
      svc.createCheckoutSession({ userId: 'u1', orderId, idempotencyKey: 'ik-2' })
    ).rejects.toMatchObject({ status: 409, code: 'ORDER_NOT_PAYABLE' });

    currentOrder = {
      ...currentOrder,
      status: 'PENDING_PAYMENT',
      checkoutState: 'READY',
      stripeSessionId: 'cs_1',
      stripeCheckoutUrl: 'https://checkout.stripe.com/c/pay/cs_1',
      stripeSessionExpiresAt: new Date(Date.now() + 60_000),
      cancellationRequestedAt: null,
      reservationExpiresAt: new Date(Date.now() + 60_000),
    };
    const reused = await svc.createCheckoutSession({ userId: 'u1', orderId, idempotencyKey: 'ik-3' });
    expect(reused.status).toBe(200);
    expect(reused.body.data.sessionId).toBe('cs_1');
  });
});

describe('Deep Coverage: OrdersService.createOrder, IdempotencyService, ChatService', () => {
  it('covers OrdersService.createOrder error branches', async () => {
    const prisma = {
      $transaction: async (fn) => fn(prisma),
      order: {
        count: jest.fn(async () => 3),
        findFirst: jest.fn(async () => null),
      },
      cart: { findUnique: jest.fn(async () => null) },
      product: { findMany: jest.fn(async () => []) },
    };
    const svc = new OrdersService(prisma, {
      idempotencyService: { execute: async ({ handler }) => handler() },
      stripeClient: {},
    });

    // 3 pending orders -> ORDER_LIMIT_EXCEEDED
    await expect(
      svc.createOrder({ userId: 'u1', idempotencyKey: 'k1', cartVersion: 1, shippingAddress: {} })
    ).rejects.toMatchObject({ status: 409, code: 'ORDER_LIMIT_EXCEEDED' });

    // Empty cart
    prisma.order.count.mockResolvedValue(0);
    await expect(
      svc.createOrder({ userId: 'u1', idempotencyKey: 'k2', cartVersion: 1, shippingAddress: {} })
    ).rejects.toMatchObject({ status: 409, code: 'CART_EMPTY' });

    // Version conflict
    prisma.cart.findUnique.mockResolvedValue({ id: 'c1', version: 2, items: [{ productId: 'p1', quantity: 1 }] });
    await expect(
      svc.createOrder({ userId: 'u1', idempotencyKey: 'k3', cartVersion: 1, shippingAddress: {} })
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });

    // Already pending for cart version
    prisma.order.findFirst.mockResolvedValueOnce({ id: 'existing-ord' });
    await expect(
      svc.createOrder({ userId: 'u1', idempotencyKey: 'k4', cartVersion: 2, shippingAddress: {} })
    ).rejects.toMatchObject({ status: 409, code: 'ORDER_ALREADY_PENDING' });

    // Product unavailable
    prisma.product.findMany.mockResolvedValueOnce([{ id: 'p1', active: false, stockOnHand: 5, stockReserved: 0, price: 100 }]);
    await expect(
      svc.createOrder({ userId: 'u1', idempotencyKey: 'k5', cartVersion: 2, shippingAddress: {} })
    ).rejects.toMatchObject({ status: 409, code: 'PRODUCT_UNAVAILABLE' });

    // Out of stock
    prisma.product.findMany.mockResolvedValueOnce([{ id: 'p1', active: true, stockOnHand: 0, stockReserved: 0, price: 100 }]);
    await expect(
      svc.createOrder({ userId: 'u1', idempotencyKey: 'k6', cartVersion: 2, shippingAddress: {} })
    ).rejects.toMatchObject({ status: 409, code: 'OUT_OF_STOCK' });
  });

  it('covers IdempotencyService hash mismatch, completed replay, and error cleanup', async () => {
    const stored = {
      id: 'id-1',
      requestHash: sha256Hex('{"a":1}'),
      status: 'COMPLETED',
      responseStatus: 201,
      responseBody: encryptEnvelope(
        { ok: true },
        { entity: 'IdempotencyRecord', rowId: 'id-1', field: 'responseBody' }
      ),
      resourceId: 'res-1',
    };
    const prisma = {
      idempotencyRecord: {
        findUnique: jest.fn(async () => stored),
        create: jest.fn(async ({ data }) => data),
        delete: jest.fn(async () => ({})),
      },
    };
    const idemp = new IdempotencyService(prisma);

    // Payload mismatch -> 409 IDEMPOTENCY_CONFLICT
    await expect(
      idemp.execute({ userId: 'u1', method: 'POST', route: '/r', key: 'k', body: { a: 2 }, handler: jest.fn() })
    ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });

    // Completed replay
    const replayed = await idemp.execute({
      userId: 'u1',
      method: 'POST',
      route: '/r',
      key: 'k',
      body: { a: 1 },
      handler: jest.fn(),
    });
    expect(replayed).toEqual({ status: 201, body: { ok: true }, resourceId: 'res-1', replayed: true });
  });

  it('covers ChatService catalog Q&A, invalid citation escalation, and sensitive leak blocking', async () => {
    const chunk = {
      chunkId: 'chunk-1',
      documentId: 'product-catalog',
      title: 'Product Catalog',
      version: '1.0',
      section: 'Catalog',
      content: 'We sell keyboards.',
    };
    const chat = new ChatService({
      knowledgeRepository: { searchApprovedChunks: jest.fn(async () => [chunk]) },
      productsRepository: {
        listProducts: jest.fn(async () => ({
          data: [{ name: 'Keyboard', sku: 'KB-1', price: 12900, availableQuantity: 5, category: { name: 'Electronics' } }],
        })),
      },
      llmClient: {
        isConfigured: () => true,
        generateGroundedAnswer: jest.fn(async () => ({
          answer: 'Hallucinated answer',
          citationIds: ['unknown-chunk-id'],
        })),
      },
    });

    // Invalid citation IDs -> deterministic escalation
    const badCit = await chat.answerMessage({ message: 'What keyboards do you sell?', ipKey: '1.1.1.1' });
    expect(badCit.escalated).toBe(true);

    // Sensitive leak in LLM output (email) -> deterministic escalation
    chat.llmClient.generateGroundedAnswer.mockResolvedValueOnce({
      answer: 'Email secret@example.com for help',
      citationIds: ['chunk-1'],
    });
    const leaked = await chat.answerMessage({ message: 'What keyboards do you sell?', ipKey: '1.1.1.1' });
    expect(leaked.escalated).toBe(true);
  });
});

describe('Deep Coverage: strictJsonBodyMiddleware, rejectDuplicateQueryParams & AuthMiddleware', () => {
  it('handles missing content-type, unsupported media/encoding, oversized body 413, empty body, stream error, and duplicate query', () => {
    const mw = strictJsonBodyMiddleware(20);

    // Missing content-type on POST
    const reqNoCt = Object.assign(new EventEmitter(), { method: 'POST', headers: {} });
    const nextNoCt = jest.fn();
    mw(reqNoCt, {}, nextNoCt);
    expect(reqNoCt.missingJsonContentType).toBe(true);
    expect(nextNoCt).toHaveBeenCalledWith();

    // Unsupported Content-Type -> 415
    const nextBadCt = jest.fn();
    mw({ method: 'POST', headers: { 'content-type': 'text/plain' } }, {}, nextBadCt);
    expect(nextBadCt).toHaveBeenCalledWith(expect.objectContaining({ status: 415 }));

    // Unsupported Content-Encoding -> 415
    const nextGzip = jest.fn();
    mw(
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } },
      {},
      nextGzip
    );
    expect(nextGzip).toHaveBeenCalledWith(expect.objectContaining({ status: 415 }));

    // Oversized body -> 413
    const reqBig = Object.assign(new EventEmitter(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      pause: jest.fn(),
    });
    const nextBig = jest.fn();
    mw(reqBig, {}, nextBig);
    reqBig.emit('data', Buffer.from('{"a":"this is way more than twenty bytes"}'));
    expect(nextBig).toHaveBeenCalledWith(expect.objectContaining({ status: 413 }));

    // Empty body -> 400
    const reqEmpty = Object.assign(new EventEmitter(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const nextEmpty = jest.fn();
    mw(reqEmpty, {}, nextEmpty);
    reqEmpty.emit('end');
    expect(nextEmpty).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));

    // Stream error -> 400
    const reqErr = Object.assign(new EventEmitter(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const nextErr = jest.fn();
    mw(reqErr, {}, nextErr);
    reqErr.emit('error', new Error('reset'));
    expect(nextErr).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));

    // Duplicate query params
    const nextDup = jest.fn();
    rejectDuplicateQueryParams({ originalUrl: '/api/v1/products?page=1&page=2' }, {}, nextDup);
    expect(nextDup).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  });

  it('AuthMiddleware rejects unauthenticated, invalid JWT, revoked session, and enforces CSRF/Origin', async () => {
    const authRepo = {
      findActiveSessionWithUser: jest.fn(async () => null),
    };
    const mw = createAuthMiddleware(authRepo);

    // Missing cookie -> 401
    const next1 = jest.fn();
    await mw.requireAuth({ cookies: {} }, {}, next1);
    expect(next1).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));

    // Invalid JWT -> 401
    const next2 = jest.fn();
    await mw.requireAuth({ cookies: { dev_session: 'invalid.jwt.token' } }, {}, next2);
    expect(next2).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));

    // Valid JWT but session revoked/missing -> 401
    const validJwt = signSessionJwt({ userId: 'u1', sessionId: 's1' });
    const next3 = jest.fn();
    await mw.requireAuth({ cookies: { dev_session: validJwt } }, {}, next3);
    expect(next3).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));

    // requireCsrfAndOrigin rejects wrong Origin & missing CSRF header
    const nextOrigin = jest.fn();
    mw.requireCsrfAndOrigin(
      { headers: { origin: 'https://evil.com' }, auth: { csrfTokenHash: sha256Hex('tok') } },
      {},
      nextOrigin
    );
    expect(nextOrigin).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });
});
