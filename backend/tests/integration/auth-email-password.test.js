process.env.NODE_ENV = 'test';

const crypto = require('crypto');
const request = require('supertest');

const { createApp } = require('../../src/app');
const { config } = require('../../src/config/env');
const { FakeMailAdapter } = require('../../src/integrations/mail/mail.adapter');
const { createInMemoryPrisma } = require('./inMemoryPrisma');

const ORIGIN = config.appOrigin;

function extractCookies(res) {
  const raw = res.headers['set-cookie'] || [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

function extractTokenFromMailText(text) {
  const match = text.match(/#token=([A-Za-z0-9_-]{43})/);
  return match ? match[1] : null;
}

async function getPreauthCsrf(app) {
  const res = await request(app).get('/api/v1/auth/csrf');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(typeof res.body.expiresAt).toBe('string');
  return {
    csrfToken: res.body.csrfToken,
    cookieHeader: extractCookies(res),
  };
}

describe('Integration: AUTH-002 Email/Password API Contract & Security', () => {
  function setup() {
    const prisma = createInMemoryPrisma();
    const mailAdapter = new FakeMailAdapter();
    const { app, services } = createApp({ prisma, mailAdapter });
    return { prisma, mailAdapter, app, services };
  }

  it('enforces Origin, preauth CSRF cookie+header, closed JSON schema, empty query, and 405 Allow', async () => {
    const { app } = setup();

    // 405 with Allow header
    const wrongMethod = await request(app).post('/api/v1/auth/csrf');
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.allow).toBe('GET');

    const getRegister = await request(app).get('/api/v1/auth/register');
    expect(getRegister.status).toBe(405);
    expect(getRegister.headers.allow).toBe('POST');

    // Query params rejected
    const csrfWithQuery = await request(app).get('/api/v1/auth/csrf?foo=bar');
    expect(csrfWithQuery.status).toBe(400);
    expect(csrfWithQuery.body.error.code).toBe('VALIDATION_ERROR');

    // Missing Origin / CSRF -> 403 CSRF_INVALID
    const noCsrf = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'user@example.com' });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_INVALID');

    const { csrfToken, cookieHeader } = await getPreauthCsrf(app);

    // Wrong Origin -> 403 CSRF_INVALID
    const badOrigin = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', 'https://evil.example.com')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'user@example.com' });
    expect(badOrigin.status).toBe(403);
    expect(badOrigin.body.error.code).toBe('CSRF_INVALID');

    // Mismatched CSRF token -> 403 CSRF_INVALID
    const badToken = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', 'A'.repeat(43))
      .send({ email: 'user@example.com' });
    expect(badToken.status).toBe(403);
    expect(badToken.body.error.code).toBe('CSRF_INVALID');

    // Unknown field / role injection -> 400 VALIDATION_ERROR
    const roleInject = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'user@example.com', password: 'some-password-12345', role: 'ADMIN' });
    expect(roleInject.status).toBe(400);
    expect(roleInject.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('completes full register -> mail worker -> verify -> login -> session -> logout flow and prevents token reuse', async () => {
    const { app, mailAdapter, services, prisma } = setup();
    const { csrfToken, cookieHeader } = await getPreauthCsrf(app);

    // 1. Register
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: '  New.User+tag@Example.COM  ' });
    expect(regRes.status).toBe(202);
    expect(regRes.body).toEqual({
      data: { message: 'If this email can be registered, verification instructions have been sent.' },
    });

    // No User created before verification
    expect(prisma._db.user).toHaveLength(0);
    expect(prisma._db.authMailOutbox).toHaveLength(1);
    expect(prisma._db.authMailOutbox[0].encryptedPayload).toBeTruthy();

    // 2. Mail worker delivers verification email and purges encryptedPayload
    const batch = await services.authMailWorker.processDueBatch();
    expect(batch.sent).toBe(1);
    expect(prisma._db.authMailOutbox[0].status).toBe('SENT');
    expect(prisma._db.authMailOutbox[0].encryptedPayload).toBeNull();

    const sentMail = mailAdapter.getMessages()[0];
    expect(sentMail.to).toBe('new.user+tag@example.com');
    expect(sentMail.text).toContain(`${ORIGIN}/verify-email#token=`);
    const verifyToken = extractTokenFromMailText(sentMail.text);
    expect(verifyToken).toHaveLength(43);

    // 3. Reject weak / blocklisted password with 400 PASSWORD_NOT_ALLOWED (without consuming token)
    const weakRes = await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({
        token: verifyToken,
        displayName: 'New User',
        password: 'Password12345678',
      });
    expect(weakRes.status).toBe(400);
    expect(weakRes.body.error.code).toBe('PASSWORD_NOT_ALLOWED');
    expect(weakRes.body.error.details[0].field).toBe('password');

    // Wrong purpose: using verify token on reset-password fails with 400 AUTH_TOKEN_INVALID
    const wrongPurposeRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({
        token: verifyToken,
        password: '  Valid Unique Passphrase 2026!  ',
      });
    expect(wrongPurposeRes.status).toBe(400);
    expect(wrongPurposeRes.body.error.code).toBe('AUTH_TOKEN_INVALID');

    // 4. Verify email with valid password (preserving leading/trailing spaces)
    const validPassword = '  My Unique Kanto Passphrase 2026!  ';
    const verifyRes = await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({
        token: verifyToken,
        displayName: '  New User  ',
        password: validPassword,
      });
    expect(verifyRes.status).toBe(201);
    expect(verifyRes.body).toEqual({
      data: { message: 'Registration successful. Please sign in.' },
    });
    // Must NOT set a session cookie on verify-email
    expect(verifyRes.headers['set-cookie']).toBeUndefined();

    // 5. Replaying the same verify token returns 400 AUTH_TOKEN_INVALID
    const replayRes = await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({
        token: verifyToken,
        displayName: 'Replay User',
        password: validPassword,
      });
    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error.code).toBe('AUTH_TOKEN_INVALID');

    // 6. Login with trimmed password fails (whitespace is NOT trimmed!)
    const badLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'new.user+tag@example.com', password: validPassword.trim() });
    expect(badLogin.status).toBe(401);
    expect(badLogin.body.error.code).toBe('INVALID_CREDENTIALS');

    // 7. Login with exact password succeeds
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'new.user+tag@example.com', password: validPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.user).toMatchObject({
      email: 'new.user+tag@example.com',
      displayName: 'New User',
      role: 'CUSTOMER',
    });
    expect(loginRes.body.data.user.passwordHash).toBeUndefined();
    expect(loginRes.body.data.user.googleSubject).toBeUndefined();

    const sessionCookie = extractCookies(loginRes);
    expect(sessionCookie).toContain(`${config.cookies.sessionName}=`);

    // 8. Fetch session and logout
    const sessionRes = await request(app).get('/api/v1/auth/session').set('Cookie', sessionCookie);
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.user.email).toBe('new.user+tag@example.com');
    const sessionCsrf = sessionRes.body.csrfToken;

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', sessionCookie)
      .set('X-CSRF-Token', sessionCsrf)
      .send({});
    expect(logoutRes.status).toBe(204);

    // Revoked session is rejected
    const afterLogout = await request(app).get('/api/v1/auth/session').set('Cookie', sessionCookie);
    expect(afterLogout.status).toBe(401);
  });

  it('prevents account enumeration across new, local, and Google-only emails and blocks local reset for Google-only', async () => {
    const { app, mailAdapter, services, prisma } = setup();
    const { csrfToken, cookieHeader } = await getPreauthCsrf(app);

    // Seed Google-only user
    prisma._db.user.push({
      id: crypto.randomUUID(),
      googleSubject: 'google-sub-only-123',
      email: 'googleonly@example.com',
      emailVerifiedAt: new Date(),
      displayName: 'Google User',
      role: 'CUSTOMER',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Register on Google-only email returns identical 202 and sends NO mail
    const regGoogle = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'googleonly@example.com' });
    expect(regGoogle.status).toBe(202);
    expect(regGoogle.body.data.message).toBe('If this email can be registered, verification instructions have been sent.');

    // Forgot-password on Google-only email returns identical 202 and sends NO mail
    const forgotGoogle = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'googleonly@example.com' });
    expect(forgotGoogle.status).toBe(202);

    // Forgot-password on nonexistent email returns identical 202 and sends NO mail
    const forgotUnknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'nobody@example.com' });
    expect(forgotUnknown.status).toBe(202);
    expect(forgotUnknown.body).toEqual(forgotGoogle.body);

    await services.authMailWorker.processDueBatch();
    expect(mailAdapter.getMessages()).toHaveLength(0);

    // Login on Google-only and nonexistent both return 401 INVALID_CREDENTIALS
    const loginGoogle = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'googleonly@example.com', password: 'AnyValidLengthPassword123!' });
    expect(loginGoogle.status).toBe(401);
    expect(loginGoogle.body.error.code).toBe('INVALID_CREDENTIALS');

    const loginUnknown = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'nobody@example.com', password: 'AnyValidLengthPassword123!' });
    expect(loginUnknown.status).toBe(401);
    expect(loginUnknown.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('executes forgot -> reset -> revokes all active sessions -> old password 401 -> new password 200', async () => {
    const { app, mailAdapter, services } = setup();
    const { csrfToken, cookieHeader } = await getPreauthCsrf(app);

    const oldPw = 'Original-Passphrase-Alpha-2026!';
    const newPw = 'Updated-Passphrase-Beta-2026!';

    // Register & verify
    await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'resetme@example.com' });
    await services.authMailWorker.processDueBatch();
    const verifyToken = extractTokenFromMailText(mailAdapter.getMessages()[0].text);

    await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ token: verifyToken, displayName: 'Reset User', password: oldPw });

    // Create two separate sessions (Browser 1 and Browser 2)
    const login1 = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'resetme@example.com', password: oldPw });
    const session1 = extractCookies(login1);

    const login2 = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'resetme@example.com', password: oldPw });
    const session2 = extractCookies(login2);

    // Request two reset tokens
    mailAdapter.clear();
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'resetme@example.com' });
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'resetme@example.com' });
    await services.authMailWorker.processDueBatch();

    const resetMsgs = mailAdapter.getMessages();
    expect(resetMsgs).toHaveLength(2);
    const resetToken1 = extractTokenFromMailText(resetMsgs[0].text);
    const resetToken2 = extractTokenFromMailText(resetMsgs[1].text);

    // Reset with token 1
    mailAdapter.clear();
    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ token: resetToken1, password: newPw });
    expect(resetRes.status).toBe(200);
    expect(resetRes.body).toEqual({
      data: { message: 'Your password has been updated. Please sign in again.' },
    });

    // Both old sessions are revoked immediately
    expect((await request(app).get('/api/v1/auth/session').set('Cookie', session1)).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/session').set('Cookie', session2)).status).toBe(401);

    // Second reset token issued before reset is now invalid (credentialVersion bumped)
    const secondReset = await request(app)
      .post('/api/v1/auth/reset-password')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ token: resetToken2, password: 'Another-Passphrase-Gamma-2026!' });
    expect(secondReset.status).toBe(400);
    expect(secondReset.body.error.code).toBe('AUTH_TOKEN_INVALID');

    // PASSWORD_CHANGED notification delivered without password/token
    await services.authMailWorker.processDueBatch();
    const notifyMsgs = mailAdapter.getMessages();
    expect(notifyMsgs).toHaveLength(1);
    expect(notifyMsgs[0].template).toBe('PASSWORD_CHANGED');
    expect(notifyMsgs[0].text).not.toContain(newPw);
    expect(notifyMsgs[0].text).not.toContain(resetToken1);

    // Old password -> 401; new password -> 200
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'resetme@example.com', password: oldPw });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'resetme@example.com', password: newPw });
    expect(newLogin.status).toBe(200);
  });

  it('enforces destination email quota (3/h silent 202), IP quota (429 + Retry-After), and mail failure handling', async () => {
    const { app, mailAdapter, services, prisma } = setup();
    const { csrfToken, cookieHeader } = await getPreauthCsrf(app);

    // 4 register requests for same email: all 202, only 3 mails enqueued
    for (let i = 0; i < 4; i += 1) {
      const r = await request(app)
        .post('/api/v1/auth/register')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieHeader)
        .set('X-CSRF-Token', csrfToken)
        .send({ email: 'quota@example.com' });
      expect(r.status).toBe(202);
    }
    expect(prisma._db.authMailOutbox).toHaveLength(3);

    // Simulate permanent mail failure: outbox marks FAILED, purges payload, records AUTH_MAIL_FAILED, does NOT consume token
    mailAdapter.setFailureMode({ failAlways: true, failCode: 'SMTP_CONN_REFUSED' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      for (const row of prisma._db.authMailOutbox) {
        row.nextAttemptAt = new Date(Date.now() - 1000);
      }
      await services.authMailWorker.processDueBatch();
    }
    expect(prisma._db.authMailOutbox.every((r) => r.status === 'FAILED')).toBe(true);
    expect(prisma._db.authMailOutbox.every((r) => r.encryptedPayload === null)).toBe(true);
    expect(prisma._db.authActionToken.every((t) => t.consumedAt === null)).toBe(true);
    expect(
      prisma._db.securityAuditOutbox.some((e) => e.eventType === 'AUTH_MAIL_FAILED')
    ).toBe(true);

    // IP rate limit on register (10/min/IP): we already sent 4, send 6 more then 11th -> 429 + Retry-After
    for (let i = 0; i < 6; i += 1) {
      const r = await request(app)
        .post('/api/v1/auth/register')
        .set('Origin', ORIGIN)
        .set('Cookie', cookieHeader)
        .set('X-CSRF-Token', csrfToken)
        .send({ email: `other${i}@example.com` });
      expect(r.status).toBe(202);
    }
    const overIpLimit = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'eleventh@example.com' });
    expect(overIpLimit.status).toBe(429);
    expect(overIpLimit.headers['retry-after']).toBeTruthy();
  });
});
