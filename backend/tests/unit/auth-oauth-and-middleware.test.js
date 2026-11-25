const crypto = require('crypto');
const { z } = require('zod');
const { AuthService } = require('../../src/modules/auth/auth.service');
const {
  validateImageUrl,
  validateQuery,
  validateBody,
  parseQueryInt,
} = require('../../src/middleware/validate');
const { mapZodError, AppError } = require('../../src/config/errors');
const {
  SmtpMailAdapter,
  FakeMailAdapter,
  createMailAdapter,
} = require('../../src/integrations/mail/mail.adapter');
const { inspectRawJsonForDuplicatesAndProto } = require('../../src/middleware/jsonParser');
const {
  constantTimeEqual,
  encryptEnvelope,
  decryptEnvelope,
  sha256Hex,
} = require('../../src/config/crypto');
const { PaymentsService } = require('../../src/modules/payments/payments.service');
const { AdminService } = require('../../src/modules/admin/admin.service');

describe('Unit: AuthService Google OAuth full flow & edge cases', () => {
  function makeOAuthSetup() {
    let savedAttempt = null;
    const users = [];
    const sessions = [];
    const authRepository = {
      createOAuthAttempt: jest.fn(async (data) => {
        savedAttempt = { ...data };
        return savedAttempt;
      }),
      consumeOAuthAttempt: jest.fn(async ({ stateHash }) => {
        if (!savedAttempt || savedAttempt.stateHash !== stateHash) return null;
        const found = savedAttempt;
        savedAttempt = null;
        return found;
      }),
      findUserByGoogleSubject: jest.fn(async (sub) => users.find((u) => u.googleSubject === sub) || null),
      findUserByEmail: jest.fn(async (email) => users.find((u) => u.email === email) || null),
      createCustomerUser: jest.fn(async (data) => {
        const u = { id: crypto.randomUUID(), role: 'CUSTOMER', ...data };
        users.push(u);
        return u;
      }),
      markUserEmailVerified: jest.fn(async (id, dt) => {
        const u = users.find((x) => x.id === id);
        if (u) u.emailVerifiedAt = dt;
      }),
      revokeSession: jest.fn(async () => ({})),
      createSession: jest.fn(async (data) => {
        const s = { id: crypto.randomUUID(), ...data };
        sessions.push(s);
        return s;
      }),
      recordSecurityAuditEvent: jest.fn(async () => ({})),
    };

    const oauthClient = {
      getToken: jest.fn(),
      verifyIdToken: jest.fn(),
    };

    const googleConfig = {
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
      redirectUri: 'http://localhost:4000/api/v1/auth/google/callback',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    };

    const svc = new AuthService(authRepository, { googleConfig, oauthClient });
    return { svc, authRepository, oauthClient, users, sessions, getSavedAttempt: () => savedAttempt };
  }

  it('throws 503 when Google OAuth is not configured', async () => {
    const svc = new AuthService({}, { googleConfig: { clientId: '', clientSecret: '' }, oauthClient: null });
    await expect(svc.startGoogleLogin({ requestId: 'r1' })).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('completes startGoogleLogin -> handleGoogleCallback for new and existing Google users', async () => {
    const { svc, oauthClient, users } = makeOAuthSetup();

    // 1. Start login
    const started = await svc.startGoogleLogin({ requestId: 'r1' });
    const parsedUrl = new URL(started.redirectUrl);
    const state = parsedUrl.searchParams.get('state');
    const nonce = parsedUrl.searchParams.get('nonce');
    expect(state).toBeTruthy();
    expect(nonce).toBeTruthy();

    // 2. Callback creates new user
    oauthClient.getToken.mockResolvedValueOnce({ tokens: { id_token: 'id-tok-1' } });
    oauthClient.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: 'google-sub-1',
        email: 'NewUser@Example.com',
        email_verified: true,
        name: 'New Google User',
        nonce,
        iss: 'https://accounts.google.com',
      }),
    });

    const result = await svc.handleGoogleCallback({
      query: { code: 'auth-code-1', state, iss: 'https://accounts.google.com', session_state: 'abc' },
      browserBindingCookie: started.browserBinding,
      existingSessionId: 'old-session-id',
      requestId: 'r2',
    });
    expect(result.jwtToken).toBeTruthy();
    expect(result.redirectUrl).toContain('/account');
    expect(users).toHaveLength(1);

    // 3. Existing Google user without emailVerifiedAt logs in again -> marks verified
    users[0].emailVerifiedAt = null;
    const started2 = await svc.startGoogleLogin({ requestId: 'r3' });
    const url2 = new URL(started2.redirectUrl);
    oauthClient.getToken.mockResolvedValueOnce({ tokens: { id_token: 'id-tok-2' } });
    oauthClient.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: 'google-sub-1',
        email: 'newuser@example.com',
        email_verified: true,
        name: 'New Google User',
        nonce: url2.searchParams.get('nonce'),
        iss: 'accounts.google.com',
      }),
    });
    const res2 = await svc.handleGoogleCallback({
      query: { code: 'auth-code-2', state: url2.searchParams.get('state') },
      browserBindingCookie: started2.browserBinding,
      requestId: 'r4',
    });
    expect(res2.jwtToken).toBeTruthy();
    expect(users[0].emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects all invalid Google OAuth callback scenarios safely', async () => {
    const { svc, oauthClient, users } = makeOAuthSetup();
    const validState = 'a'.repeat(43);

    // Unknown param / bad iss / missing state / both code+error / missing attempt
    await expect(
      svc.handleGoogleCallback({ query: { evil: '1', state: validState, code: 'c' }, browserBindingCookie: 'b' })
    ).rejects.toMatchObject({ status: 400, code: 'OAUTH_INVALID' });
    await expect(
      svc.handleGoogleCallback({ query: { state: 'x'.repeat(1025), code: 'c' }, browserBindingCookie: 'b' })
    ).rejects.toMatchObject({ status: 400, code: 'OAUTH_INVALID' });
    await expect(
      svc.handleGoogleCallback({ query: { iss: 'https://evil.com', state: validState, code: 'c' }, browserBindingCookie: 'b' })
    ).rejects.toMatchObject({ status: 400, code: 'OAUTH_INVALID' });
    await expect(
      svc.handleGoogleCallback({ query: { state: 'short', code: 'c' }, browserBindingCookie: 'b' })
    ).rejects.toMatchObject({ status: 400, code: 'OAUTH_INVALID' });
    await expect(
      svc.handleGoogleCallback({ query: { state: validState, code: 'c', error: 'e' }, browserBindingCookie: 'b' })
    ).rejects.toMatchObject({ status: 400, code: 'OAUTH_INVALID' });
    await expect(
      svc.handleGoogleCallback({ query: { state: validState, code: 'c' }, browserBindingCookie: 'b' })
    ).rejects.toMatchObject({ status: 400, code: 'OAUTH_INVALID' });

    // Browser binding mismatch
    const s1 = await svc.startGoogleLogin({ requestId: 'r1' });
    const st1 = new URL(s1.redirectUrl).searchParams.get('state');
    await expect(
      svc.handleGoogleCallback({ query: { state: st1, code: 'c' }, browserBindingCookie: 'wrong-cookie' })
    ).rejects.toMatchObject({ status: 400, code: 'OAUTH_INVALID' });

    // User denied consent
    const s2 = await svc.startGoogleLogin({ requestId: 'r2' });
    const st2 = new URL(s2.redirectUrl).searchParams.get('state');
    await expect(
      svc.handleGoogleCallback({ query: { state: st2, error: 'access_denied' }, browserBindingCookie: s2.browserBinding })
    ).rejects.toMatchObject({ status: 401, code: 'OAUTH_DENIED' });

    // getToken throws -> 503
    const s3 = await svc.startGoogleLogin({ requestId: 'r3' });
    const st3 = new URL(s3.redirectUrl).searchParams.get('state');
    oauthClient.getToken.mockRejectedValueOnce(new Error('network'));
    await expect(
      svc.handleGoogleCallback({ query: { state: st3, code: 'c' }, browserBindingCookie: s3.browserBinding })
    ).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });

    // Missing id_token -> 400
    const s4 = await svc.startGoogleLogin({ requestId: 'r4' });
    const st4 = new URL(s4.redirectUrl).searchParams.get('state');
    oauthClient.getToken.mockResolvedValueOnce({ tokens: {} });
    await expect(
      svc.handleGoogleCallback({ query: { state: st4, code: 'c' }, browserBindingCookie: s4.browserBinding })
    ).rejects.toMatchObject({ status: 400, code: 'OAUTH_INVALID' });

    // verifyIdToken throws -> 400
    const s5 = await svc.startGoogleLogin({ requestId: 'r5' });
    const st5 = new URL(s5.redirectUrl).searchParams.get('state');
    oauthClient.getToken.mockResolvedValueOnce({ tokens: { id_token: 'bad' } });
    oauthClient.verifyIdToken.mockRejectedValueOnce(new Error('bad sig'));
    await expect(
      svc.handleGoogleCallback({ query: { state: st5, code: 'c' }, browserBindingCookie: s5.browserBinding })
    ).rejects.toMatchObject({ status: 400, code: 'OAUTH_INVALID' });

    // Invalid claims (wrong nonce) -> 400
    const s6 = await svc.startGoogleLogin({ requestId: 'r6' });
    const st6 = new URL(s6.redirectUrl).searchParams.get('state');
    oauthClient.getToken.mockResolvedValueOnce({ tokens: { id_token: 'tok' } });
    oauthClient.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: 'sub-x',
        email: 'a@b.com',
        email_verified: true,
        nonce: 'wrong-nonce',
        iss: 'https://accounts.google.com',
      }),
    });
    await expect(
      svc.handleGoogleCallback({ query: { state: st6, code: 'c' }, browserBindingCookie: s6.browserBinding })
    ).rejects.toMatchObject({ status: 400, code: 'OAUTH_INVALID' });

    // Account link required (email already exists without googleSubject) -> 409
    users.push({ id: 'u-local', email: 'taken@example.com', googleSubject: null, role: 'CUSTOMER' });
    const s7 = await svc.startGoogleLogin({ requestId: 'r7' });
    const u7 = new URL(s7.redirectUrl);
    oauthClient.getToken.mockResolvedValueOnce({ tokens: { id_token: 'tok' } });
    oauthClient.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: 'sub-new',
        email: 'taken@example.com',
        email_verified: true,
        nonce: u7.searchParams.get('nonce'),
        iss: 'https://accounts.google.com',
      }),
    });
    await expect(
      svc.handleGoogleCallback({
        query: { state: u7.searchParams.get('state'), code: 'c' },
        browserBindingCookie: s7.browserBinding,
      })
    ).rejects.toMatchObject({ status: 409, code: 'ACCOUNT_LINK_REQUIRED' });
  });
});

describe('Unit: Middleware Validate, Zod Mapper, JsonParser, Mail & Crypto', () => {
  it('validateImageUrl enforces HTTPS, no credentials, no private IPs, and production allowlist', () => {
    expect(validateImageUrl(null).valid).toBe(true);
    expect(validateImageUrl(123).valid).toBe(false);
    expect(validateImageUrl('not-a-url').valid).toBe(false);
    expect(validateImageUrl('http://cdn.example.com/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://user:pass@cdn.example.com/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://cdn.example.com:8443/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://localhost/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://127.0.0.1/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://10.0.0.1/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://192.168.1.1/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://169.254.169.254/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://172.16.0.1/a.jpg').valid).toBe(false);
    expect(
      validateImageUrl('https://evil.com/a.jpg', {
        isProduction: true,
        approvedOrigins: ['https://cdn.example.com'],
      }).valid
    ).toBe(false);
    expect(
      validateImageUrl('https://cdn.example.com/a.jpg', {
        isProduction: true,
        approvedOrigins: ['https://cdn.example.com'],
      }).valid
    ).toBe(true);
  });

  it('validateQuery, validateBody, parseQueryInt, and mapZodError handle all error shapes', () => {
    const schema = z.object({ count: z.number().min(1).max(10) }).strict();
    const res = schema.safeParse({ count: 'bad', extra: true });
    const mapped = mapZodError(res.error, 'body');
    expect(mapped.status).toBe(400);
    expect(mapped.details.length).toBeGreaterThanOrEqual(2);

    const req = { query: { count: 'not-a-number' } };
    const next = jest.fn();
    validateQuery(schema)(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.any(AppError));

    const okReq = { query: { count: 5 } };
    const nextOk = jest.fn();
    validateQuery(schema)(okReq, {}, nextOk);
    expect(okReq.validatedQuery).toEqual({ count: 5 });

    const badCtNext = jest.fn();
    validateBody(schema)({ missingJsonContentType: true, body: {} }, {}, badCtNext);
    expect(badCtNext).toHaveBeenCalledWith(expect.objectContaining({ status: 415 }));

    expect(parseQueryInt('abc', 'page', 1, 10).error.code).toBe('FORMAT');
    expect(parseQueryInt('999', 'page', 1, 10).error.code).toBe('RANGE');
    expect(parseQueryInt('5', 'page', 1, 10).value).toBe(5);
  });

  it('inspectRawJsonForDuplicatesAndProto parses valid primitives/escapes and rejects malformed/deep JSON', () => {
    expect(() =>
      inspectRawJsonForDuplicatesAndProto(
        '{"arr":[1,-2.5,3e2,true,false,null],"str":"hi \\" \\\\ \\/ \\b \\f \\n \\r \\t \\u0041"}'
      )
    ).not.toThrow();

    expect(() => inspectRawJsonForDuplicatesAndProto('{"a":1} trailing')).toThrow();
    expect(() => inspectRawJsonForDuplicatesAndProto('{"a":tru}')).toThrow();
    expect(() => inspectRawJsonForDuplicatesAndProto('{"a":fals}')).toThrow();
    expect(() => inspectRawJsonForDuplicatesAndProto('{"a":nul}')).toThrow();
    expect(() => inspectRawJsonForDuplicatesAndProto('{"a":"\\x"}')).toThrow();
    expect(() => inspectRawJsonForDuplicatesAndProto('{"a":"\\uZZZZ"}')).toThrow();
    expect(() => inspectRawJsonForDuplicatesAndProto('{"a":@}')).toThrow();
    expect(() => inspectRawJsonForDuplicatesAndProto('{"a":1')).toThrow();
    expect(() => inspectRawJsonForDuplicatesAndProto('{"a":1,"a":2}')).toThrow(AppError);
    expect(() => inspectRawJsonForDuplicatesAndProto('{"constructor":{}}')).toThrow(AppError);
    expect(() => inspectRawJsonForDuplicatesAndProto('{"prototype":{}}')).toThrow(AppError);
  });

  it('SmtpMailAdapter, FakeMailAdapter, createMailAdapter, and crypto helpers work properly', async () => {
    expect(createMailAdapter({ transport: 'fake' })).toBeInstanceOf(FakeMailAdapter);
    expect(createMailAdapter({ transport: 'smtp', smtpHost: 'smtp.test' })).toBeInstanceOf(SmtpMailAdapter);

    const unconfiguredSmtp = new SmtpMailAdapter({ smtpHost: '' });
    await expect(
      unconfiguredSmtp.sendMail({ to: 'a@b.com', subject: 'hi', text: 'body' })
    ).rejects.toMatchObject({ code: 'SMTP_NOT_CONFIGURED' });

    const smtp = new SmtpMailAdapter({
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'u',
      smtpPass: 'p',
      from: 'no-reply@example.com',
      timeoutMs: 5000,
    });
    const sendMailMock = jest.fn(async () => ({ messageId: 'smtp-msg-1' }));
    smtp.transporter = { sendMail: sendMailMock };
    const sent = await smtp.sendMail({ to: 'a@b.com', subject: 's', text: 't', dedupeKey: 'dk-1' });
    expect(sent.messageId).toBe('smtp-msg-1');

    // Crypto edge cases
    expect(constantTimeEqual('short', 'much-longer')).toBe(false);
    expect(constantTimeEqual(sha256Hex('x'), sha256Hex('x'))).toBe(true);
    expect(() => decryptEnvelope(null, { entity: 'E', rowId: '1', field: 'f' })).toThrow();
    const env = encryptEnvelope({ a: 1 }, { entity: 'E', rowId: '1', field: 'f' });
    expect(() =>
      decryptEnvelope({ ...env, ciphertext: 'AAAA' }, { entity: 'E', rowId: '1', field: 'f' })
    ).toThrow();
  });
});

describe('Unit: PaymentsService & AdminService remaining branches', () => {
  it('PaymentsService handles checkout errors, webhook expiry/failure, and reconcilePendingWork steps', async () => {
    const orderId = '55555555-5555-4555-8555-555555555555';
    const expiredOrder = {
      id: orderId,
      userId: 'u1',
      status: 'PENDING_PAYMENT',
      checkoutState: 'READY',
      stripeSessionId: 'cs_exp_1',
      grandTotal: 5000,
      version: 1,
      reservationExpiresAt: new Date(Date.now() - 60_000),
      cancellationRequestedAt: null,
      items: [],
      reservations: [],
    };
    const staleCreatingOrder = {
      id: '66666666-6666-4666-8666-666666666666',
      status: 'PENDING_PAYMENT',
      checkoutState: 'CREATING',
      stripeSessionId: null,
      version: 1,
    };
    const unpaidNoSessionExpired = {
      id: '77777777-7777-4777-8777-777777777777',
      status: 'PENDING_PAYMENT',
      checkoutState: 'NOT_STARTED',
      stripeSessionId: null,
      version: 1,
    };

    const prisma = {
      $transaction: async (fn) => fn(prisma),
      webhookEvent: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }) => data),
        update: jest.fn(async ({ data }) => data),
      },
      order: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => expiredOrder),
        findMany: jest.fn(async ({ where }) => {
          if (where.checkoutState === 'CREATING') return [staleCreatingOrder];
          if (where.stripeSessionId === null) return [unpaidNoSessionExpired];
          return [expiredOrder];
        }),
        update: jest.fn(async ({ data }) => ({ ...expiredOrder, ...data })),
      },
    };

    const stripeClient = {
      retrieveCheckoutSession: jest.fn(async () => ({
        id: 'cs_exp_1',
        payment_status: 'unpaid',
        status: 'open',
      })),
      expireCheckoutSession: jest.fn(async () => ({})),
    };
    const ordersService = {
      releaseReservationsAndCancelOrder: jest.fn(async () => ({})),
    };
    const idempotencyService = {
      execute: async ({ handler }) => handler(),
    };

    const svc = new PaymentsService(prisma, { stripeClient, ordersService, idempotencyService });

    // Order not found in createCheckoutSession
    await expect(
      svc.createCheckoutSession({ userId: 'u1', orderId, idempotencyKey: 'ik-1' })
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });

    // Reconcile all 3 steps: stale CREATING, expired no-session, expired open Stripe session
    await svc.reconcilePendingWork();
    expect(stripeClient.expireCheckoutSession).toHaveBeenCalledWith('cs_exp_1');
    expect(ordersService.releaseReservationsAndCancelOrder).toHaveBeenCalled();
  });

  it('AdminService enforces version conflicts, stock floor, and reservation release on CANCELLED', async () => {
    const order = {
      id: '88888888-8888-4888-8888-888888888888',
      status: 'PENDING_PAYMENT',
      grandTotal: 5000,
      version: 2,
      items: [],
      reservations: [{ id: 'r1', productId: 'p1', quantity: 2, status: 'ACTIVE' }],
      shippingAddress: encryptEnvelope(
        { fullName: 'A', line1: '1 St', city: 'NY', region: 'NY', postalCode: '10001', country: 'US' },
        { entity: 'Order', rowId: '88888888-8888-4888-8888-888888888888', field: 'shippingAddress' }
      ),
      subtotal: 5000,
      shippingTotal: 0,
      taxTotal: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      reservationExpiresAt: new Date(),
      paidAt: null,
      cancellationRequestedAt: null,
    };
    const product = {
      id: 'p1',
      sku: 'SKU-1',
      name: 'Item',
      description: 'Desc',
      price: 5000,
      stockOnHand: 5,
      stockReserved: 3,
      active: true,
      version: 1,
      categoryId: '11111111-1111-4111-8111-111111111111',
      category: { id: '11111111-1111-4111-8111-111111111111', name: 'Cat', slug: 'cat' },
    };

    const prisma = {
      $transaction: async (fn) => fn(prisma),
      order: {
        findUnique: jest.fn(async ({ where }) => (where.id === order.id ? order : null)),
        update: jest.fn(async ({ data }) => ({ ...order, ...data })),
      },
      product: {
        findUnique: jest.fn(async ({ where }) => (where.id === 'p1' ? product : null)),
        update: jest.fn(async ({ data }) => ({ ...product, ...data })),
      },
      inventoryReservation: { update: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    };

    const adminSvc = new AdminService(prisma, { productsRepository: {}, ordersService: {} });

    // updateOrder: not found & version conflict & PENDING_PAYMENT -> CANCELLED
    await expect(
      adminSvc.updateOrder({ orderId: 'missing', data: { version: 1 }, actorId: 'a1', requestId: 'r1' })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      adminSvc.updateOrder({ orderId: order.id, data: { version: 99 }, actorId: 'a1', requestId: 'r1' })
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });

    const cancelled = await adminSvc.updateOrder({
      orderId: order.id,
      data: { status: 'CANCELLED', version: 2 },
      actorId: 'a1',
      requestId: 'r1',
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(prisma.inventoryReservation.update).toHaveBeenCalled();

    // deleteOrder: not found & version conflict
    await expect(
      adminSvc.deleteOrder({ orderId: 'missing', version: 1, actorId: 'a1', requestId: 'r1' })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      adminSvc.deleteOrder({ orderId: order.id, version: 99, actorId: 'a1', requestId: 'r1' })
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });

    // updateProduct: stockOnHand < stockReserved -> 409 CONFLICT
    await expect(
      adminSvc.updateProduct({
        productId: 'p1',
        data: { stockOnHand: 1, version: 1 },
        actorId: 'a1',
        requestId: 'r1',
      })
    ).rejects.toMatchObject({ status: 409 });

    // createProduct: invalid imageUrl -> 400
    await expect(
      adminSvc.createProduct({
        data: {
          sku: 'X',
          name: 'X',
          description: 'X',
          categoryId: product.categoryId,
          price: 100,
          imageUrl: 'http://localhost/evil.png',
          stockOnHand: 5,
          active: true,
        },
        actorId: 'a1',
        requestId: 'r1',
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});
