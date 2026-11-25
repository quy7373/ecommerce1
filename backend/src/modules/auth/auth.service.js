const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { config } = require('../../config/env');
const {
  sha256Hex,
  hmacSha256Hex,
  randomBase64Url,
  constantTimeEqual,
  encryptEnvelope,
  decryptEnvelope,
  signSessionJwt,
} = require('../../config/crypto');
const { AppError } = require('../../config/errors');
const { SlidingWindowRateLimiter } = require('../../middleware/rateLimit');
const { PasswordService } = require('./password.service');
const { assertNewPasswordAllowed } = require('./auth.validator');

const REGISTER_ACCEPTED_MESSAGE =
  'If this email can be registered, verification instructions have been sent.';
const VERIFY_EMAIL_SUCCESS_MESSAGE = 'Registration successful. Please sign in.';
const FORGOT_PASSWORD_ACCEPTED_MESSAGE =
  'If this account supports password reset, instructions have been sent.';
const RESET_PASSWORD_SUCCESS_MESSAGE =
  'Your password has been updated. Please sign in again.';

function computePkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function serializeUserDto(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

class AuthService {
  constructor(authRepository, options = {}) {
    this.authRepository = authRepository;
    this.googleConfig = options.googleConfig || config.google;
    this.passwordService = options.passwordService || new PasswordService();
    this.rateLimiter = options.rateLimiter || new SlidingWindowRateLimiter();
    this.mailEncryption = options.mailEncryption || config.mailEncryption;
    this.oauthClient =
      options.oauthClient ||
      (this.googleConfig.clientId
        ? new OAuth2Client(
            this.googleConfig.clientId,
            this.googleConfig.clientSecret,
            this.googleConfig.redirectUri
          )
        : null);
  }

  _emailQuotaKey(prefix, normalizedEmail) {
    return `${prefix}:${hmacSha256Hex(normalizedEmail, config.auth.emailHmacSecret)}`;
  }

  _encryptMailPayload(outboxId, payloadObj) {
    return encryptEnvelope(
      payloadObj,
      {
        entity: 'AuthMailOutbox',
        rowId: outboxId,
        field: 'encryptedPayload',
      },
      {
        keyId: this.mailEncryption.keyId,
        masterKey: this.mailEncryption.masterKey,
      }
    );
  }

  async _createSessionForUser({ user, existingSessionId, provider, requestId }) {
    if (existingSessionId) {
      await this.authRepository.revokeSession(existingSessionId).catch(() => {});
    }

    const csrfToken = randomBase64Url(32);
    const expiresAt = new Date(Date.now() + config.cookies.sessionMaxAgeSec * 1000);
    const session = await this.authRepository.createSession({
      userId: user.id,
      csrfTokenHash: sha256Hex(csrfToken),
      expiresAt,
    });

    const jwtToken = signSessionJwt({
      userId: user.id,
      sessionId: session.id,
    });

    await this.authRepository
      .recordSecurityAuditEvent({
        eventType: 'AUTH_LOGIN_SUCCEEDED',
        requestId,
        actorId: user.id,
        outcome: 'SUCCESS',
        metadata: { provider },
      })
      .catch(() => {});

    return { jwtToken, expiresAt, session };
  }

  ensureGoogleConfigured() {
    if (!this.googleConfig.clientId || !this.googleConfig.clientSecret || !this.oauthClient) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Google identity provider is not configured.');
    }
  }

  issuePreauthCsrf() {
    const csrfToken = randomBase64Url(32);
    const expiresAt = new Date(Date.now() + config.cookies.preauthMaxAgeSec * 1000);
    return {
      csrfToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async startGoogleLogin({ requestId }) {
    this.ensureGoogleConfigured();

    const attemptId = crypto.randomUUID();
    const state = randomBase64Url(32);
    const nonce = randomBase64Url(32);
    const browserBinding = randomBase64Url(32);
    const codeVerifier = randomBase64Url(48);
    const codeChallenge = computePkceChallenge(codeVerifier);
    const expiresAt = new Date(Date.now() + config.cookies.oauthMaxAgeSec * 1000);

    const encryptedEnvelope = encryptEnvelope(codeVerifier, {
      entity: 'OAuthAttempt',
      rowId: attemptId,
      field: 'encryptedCodeVerifier',
    });

    await this.authRepository.createOAuthAttempt({
      id: attemptId,
      stateHash: sha256Hex(state),
      browserBindingHash: sha256Hex(browserBinding),
      nonceHash: sha256Hex(nonce),
      encryptedCodeVerifier: JSON.stringify(encryptedEnvelope),
      expiresAt,
    });

    await this.authRepository
      .recordSecurityAuditEvent({
        eventType: 'AUTH_LOGIN_STARTED',
        requestId,
        outcome: 'SUCCESS',
        metadata: { provider: 'google' },
      })
      .catch(() => {});

    const authUrl = new URL(this.googleConfig.authUrl);
    authUrl.searchParams.set('client_id', this.googleConfig.clientId);
    authUrl.searchParams.set('redirect_uri', this.googleConfig.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return {
      redirectUrl: authUrl.toString(),
      browserBinding,
    };
  }

  async handleGoogleCallback({ query, browserBindingCookie, existingSessionId, requestId }) {
    this.ensureGoogleConfigured();

    const allowedKeys = new Set([
      'code',
      'state',
      'error',
      'scope',
      'authuser',
      'prompt',
      'hd',
      'iss',
      'session_state',
      'error_description',
      'error_uri',
    ]);

    for (const [k, v] of Object.entries(query || {})) {
      if (!allowedKeys.has(k) || typeof v !== 'string' || v.length > 4096) {
        throw new AppError(400, 'OAUTH_INVALID', 'Invalid OAuth callback parameters.');
      }
      if (k !== 'code' && v.length > 1024) {
        throw new AppError(400, 'OAUTH_INVALID', 'OAuth callback parameter exceeds length limit.');
      }
    }

    if (query?.iss && query.iss !== 'https://accounts.google.com') {
      throw new AppError(400, 'OAUTH_INVALID', 'Invalid OAuth issuer parameter.');
    }

    const { code, state, error } = query || {};
    if (!state || state.length < 32 || state.length > 256 || !browserBindingCookie) {
      throw new AppError(400, 'OAUTH_INVALID', 'Missing or invalid OAuth state.');
    }
    if ((code && error) || (!code && !error)) {
      throw new AppError(400, 'OAUTH_INVALID', 'Malformed OAuth callback response.');
    }

    const attempt = await this.authRepository.consumeOAuthAttempt({
      stateHash: sha256Hex(state),
    });

    if (!attempt) {
      throw new AppError(400, 'OAUTH_INVALID', 'OAuth state is invalid, expired, or already used.');
    }

    if (!constantTimeEqual(sha256Hex(browserBindingCookie), attempt.browserBindingHash)) {
      throw new AppError(400, 'OAUTH_INVALID', 'OAuth browser binding mismatch.');
    }

    if (error) {
      await this.authRepository
        .recordSecurityAuditEvent({
          eventType: 'AUTH_LOGIN_DENIED',
          requestId,
          outcome: 'DENIED',
          reasonCode: 'OAUTH_DENIED',
          metadata: { provider: 'google' },
        })
        .catch(() => {});
      throw new AppError(401, 'OAUTH_DENIED', 'Google sign-in was denied or cancelled.');
    }

    let codeVerifier;
    try {
      const envelope = JSON.parse(attempt.encryptedCodeVerifier);
      codeVerifier = decryptEnvelope(envelope, {
        entity: 'OAuthAttempt',
        rowId: attempt.id,
        field: 'encryptedCodeVerifier',
      });
    } catch (_) {
      throw new AppError(400, 'OAUTH_INVALID', 'OAuth verifier integrity check failed.');
    }

    let idToken;
    try {
      const tokenResponse = await this.oauthClient.getToken({
        code,
        codeVerifier,
        redirect_uri: this.googleConfig.redirectUri,
      });
      idToken = tokenResponse?.tokens?.id_token;
    } catch (_) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Unable to exchange authorization code with Google.');
    }

    if (!idToken) {
      throw new AppError(400, 'OAUTH_INVALID', 'Google did not return an ID token.');
    }

    let payload;
    try {
      const ticket = await this.oauthClient.verifyIdToken({
        idToken,
        audience: this.googleConfig.clientId,
      });
      payload = ticket.getPayload();
    } catch (_) {
      throw new AppError(400, 'OAUTH_INVALID', 'Google ID token verification failed.');
    }

    if (
      !payload ||
      !payload.sub ||
      !payload.email ||
      payload.email_verified !== true ||
      !payload.nonce ||
      !constantTimeEqual(sha256Hex(payload.nonce), attempt.nonceHash) ||
      (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com')
    ) {
      throw new AppError(400, 'OAUTH_INVALID', 'Google ID token claims are invalid.');
    }

    const normalizedEmail = payload.email.trim().toLowerCase().slice(0, 254);
    const displayName = (payload.name || '').trim().normalize('NFC').slice(0, 100) || 'Customer';
    const verifiedAt = new Date();

    let user = await this.authRepository.findUserByGoogleSubject(payload.sub);
    if (!user) {
      const existingByEmail = await this.authRepository.findUserByEmail(normalizedEmail);
      if (existingByEmail) {
        throw new AppError(
          409,
          'ACCOUNT_LINK_REQUIRED',
          'An account with this email already exists and requires explicit linking.'
        );
      }
      user = await this.authRepository.createCustomerUser({
        googleSubject: payload.sub,
        email: normalizedEmail,
        displayName,
        emailVerifiedAt: verifiedAt,
      });
    } else if (!user.emailVerifiedAt) {
      await this.authRepository.markUserEmailVerified(user.id, verifiedAt).catch(() => {});
    }

    const { jwtToken } = await this._createSessionForUser({
      user,
      existingSessionId,
      provider: 'google',
      requestId,
    });

    return {
      jwtToken,
      redirectUrl: `${config.appOrigin}/account`,
    };
  }

  async requestRegistration({ email, requestId }) {
    const quotaKey = this._emailQuotaKey('auth_register_dest', email);
    const quota = this.rateLimiter.consume(quotaKey, 3, 60 * 60 * 1000);
    if (!quota.allowed) {
      return { data: { message: REGISTER_ACCEPTED_MESSAGE } };
    }

    const now = new Date();
    const tokenId = crypto.randomUUID();
    const rawToken = randomBase64Url(32);
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(now.getTime() + config.auth.verifyTokenTtlSec * 1000);
    const outboxId = crypto.randomUUID();
    const encryptedPayload = this._encryptMailPayload(outboxId, {
      to: email,
      token: rawToken,
      expiresAt: expiresAt.toISOString(),
    });

    try {
      await this.authRepository.createRegistrationTokenAndMail({
        email,
        tokenId,
        tokenHash,
        expiresAt,
        maxActiveTokens: config.auth.maxActiveTokensPerPurpose,
        outboxId,
        dedupeKey: `verify:${tokenId}`,
        encryptedPayload,
        requestId,
        now,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Unable to process registration request right now.');
    }

    return { data: { message: REGISTER_ACCEPTED_MESSAGE } };
  }

  async registerWithPassword({ email, displayName, password, requestId }) {
    assertNewPasswordAllowed(password);

    const existing = await this.authRepository.findUserByEmail(email);
    if (existing) {
      throw new AppError(
        409,
        'EMAIL_ALREADY_EXISTS',
        'An account with this email address already exists. Please sign in instead.'
      );
    }

    // Hash Argon2id OUTSIDE transaction so DB locks are never held during hashing
    const passwordHash = await this.passwordService.hashPassword(password);
    const now = new Date();

    try {
      await this.authRepository.createVerifiedPasswordUser({
        email,
        displayName,
        passwordHash,
        requestId,
        now,
      });
    } catch (err) {
      if (err && err.code === 'P2002') {
        throw new AppError(
          409,
          'EMAIL_ALREADY_EXISTS',
          'An account with this email address already exists. Please sign in instead.'
        );
      }
      if (err instanceof AppError) throw err;
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Unable to complete registration right now.');
    }

    return { data: { message: VERIFY_EMAIL_SUCCESS_MESSAGE } };
  }

  async verifyEmailRegistration({ token, displayName, password, requestId }) {
    assertNewPasswordAllowed(password);

    const tokenHash = sha256Hex(token);
    const now = new Date();

    let preliminary;
    try {
      preliminary = await this.authRepository.findActionTokenByHash(tokenHash);
    } catch (_) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Verification service is temporarily unavailable.');
    }

    if (
      !preliminary ||
      preliminary.purpose !== 'VERIFY_EMAIL' ||
      preliminary.consumedAt !== null ||
      new Date(preliminary.expiresAt) <= now
    ) {
      throw new AppError(400, 'AUTH_TOKEN_INVALID', 'Verification link is invalid or has expired.');
    }

    // Hash Argon2id OUTSIDE transaction so DB locks are never held during hashing
    const passwordHash = await this.passwordService.hashPassword(password);

    let result;
    try {
      result = await this.authRepository.completeEmailVerificationTransaction({
        tokenHash,
        displayName,
        passwordHash,
        requestId,
        now: new Date(),
      });
    } catch (err) {
      if (err && err.code === 'P2002') {
        throw new AppError(400, 'AUTH_TOKEN_INVALID', 'Verification link is invalid or has expired.');
      }
      if (err instanceof AppError) throw err;
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Unable to complete registration right now.');
    }

    if (!result.ok) {
      throw new AppError(400, 'AUTH_TOKEN_INVALID', 'Verification link is invalid or has expired.');
    }

    return { data: { message: VERIFY_EMAIL_SUCCESS_MESSAGE } };
  }

  async loginWithPassword({ email, password, existingSessionId, requestId }) {
    // Per-email destination rate limit: 10/min uniform for existing & non-existing emails
    const destKey = this._emailQuotaKey('auth_login_dest', email);
    const destQuota = this.rateLimiter.consume(destKey, 10, 60 * 1000);
    if (!destQuota.allowed) {
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many requests. Please try again later.',
        [],
        { 'Retry-After': String(destQuota.retryAfterSec) }
      );
    }

    let user;
    try {
      user = await this.authRepository.findUserWithCredentialByEmail(email);
    } catch (_) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Authentication service is temporarily unavailable.');
    }

    const credential = user?.credential || null;
    const eligible = Boolean(user && credential && user.emailVerifiedAt);

    if (!eligible) {
      await this.passwordService.verifyDummy(password);
      await this.authRepository
        .recordSecurityAuditEvent({
          eventType: 'AUTH_LOGIN_FAILED',
          requestId,
          actorId: user?.id || null,
          outcome: 'DENIED',
          reasonCode: 'INVALID_CREDENTIALS',
          metadata: { provider: 'password' },
        })
        .catch(() => {});
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const valid = await this.passwordService.verifyPassword(credential.passwordHash, password);
    if (!valid) {
      await this.authRepository
        .recordSecurityAuditEvent({
          eventType: 'AUTH_LOGIN_FAILED',
          requestId,
          actorId: user.id,
          outcome: 'DENIED',
          reasonCode: 'INVALID_CREDENTIALS',
          metadata: { provider: 'password' },
        })
        .catch(() => {});
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    // Rehash outside transaction if Argon2 parameters were upgraded
    let rehashedPasswordHash = null;
    if (this.passwordService.needsRehash(credential.passwordHash)) {
      rehashedPasswordHash = await this.passwordService.hashPassword(password);
    }

    const csrfToken = randomBase64Url(32);
    const sessionExpiresAt = new Date(Date.now() + config.cookies.sessionMaxAgeSec * 1000);

    let finalized;
    try {
      finalized = await this.authRepository.finalizePasswordLoginTransaction({
        userId: user.id,
        expectedVersion: credential.version,
        expectedHash: credential.passwordHash,
        rehashedPasswordHash,
        existingSessionId,
        csrfTokenHash: sha256Hex(csrfToken),
        sessionExpiresAt,
        requestId,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Authentication service is temporarily unavailable.');
    }

    if (!finalized.ok) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const jwtToken = signSessionJwt({
      userId: finalized.user.id,
      sessionId: finalized.session.id,
    });

    return {
      jwtToken,
      body: {
        data: {
          user: serializeUserDto(finalized.user),
          expiresAt: sessionExpiresAt.toISOString(),
        },
      },
    };
  }

  async requestPasswordReset({ email, requestId }) {
    const quotaKey = this._emailQuotaKey('auth_forgot_dest', email);
    const quota = this.rateLimiter.consume(quotaKey, 3, 60 * 60 * 1000);
    if (!quota.allowed) {
      return { data: { message: FORGOT_PASSWORD_ACCEPTED_MESSAGE } };
    }

    const now = new Date();
    const tokenId = crypto.randomUUID();
    const rawToken = randomBase64Url(32);
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(now.getTime() + config.auth.resetTokenTtlSec * 1000);
    const outboxId = crypto.randomUUID();
    const encryptedPayload = this._encryptMailPayload(outboxId, {
      to: email,
      token: rawToken,
      expiresAt: expiresAt.toISOString(),
    });

    try {
      await this.authRepository.createPasswordResetTokenAndMail({
        email,
        tokenId,
        tokenHash,
        expiresAt,
        maxActiveTokens: config.auth.maxActiveTokensPerPurpose,
        outboxId,
        dedupeKey: `reset:${tokenId}`,
        encryptedPayload,
        requestId,
        now,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Unable to process password reset request right now.');
    }

    return { data: { message: FORGOT_PASSWORD_ACCEPTED_MESSAGE } };
  }

  async resetPassword({ token, password, requestId }) {
    assertNewPasswordAllowed(password);

    const tokenHash = sha256Hex(token);
    const now = new Date();

    let preliminary;
    try {
      preliminary = await this.authRepository.findActionTokenByHash(tokenHash);
    } catch (_) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Password reset service is temporarily unavailable.');
    }

    if (
      !preliminary ||
      preliminary.purpose !== 'RESET_PASSWORD' ||
      preliminary.consumedAt !== null ||
      new Date(preliminary.expiresAt) <= now
    ) {
      throw new AppError(400, 'AUTH_TOKEN_INVALID', 'Password reset link is invalid or has expired.');
    }

    // Hash Argon2id OUTSIDE transaction
    const newPasswordHash = await this.passwordService.hashPassword(password);

    let result;
    try {
      result = await this.authRepository.completePasswordResetTransaction({
        tokenHash,
        newPasswordHash,
        requestId,
        now: new Date(),
        buildNotificationOutbox: ({ userId, email, newVersion }) => {
          const outboxId = crypto.randomUUID();
          return {
            outboxId,
            dedupeKey: `pwchg:${userId}:${newVersion}`,
            encryptedPayload: this._encryptMailPayload(outboxId, { to: email }),
          };
        },
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Unable to complete password reset right now.');
    }

    if (!result.ok) {
      throw new AppError(400, 'AUTH_TOKEN_INVALID', 'Password reset link is invalid or has expired.');
    }

    return { data: { message: RESET_PASSWORD_SUCCESS_MESSAGE } };
  }

  async getSessionAndRotateCsrf({ sessionId, user, sessionExpiresAt }) {
    const newCsrfToken = randomBase64Url(32);
    await this.authRepository.rotateCsrfTokenHash(sessionId, sha256Hex(newCsrfToken));
    return {
      user: serializeUserDto(user),
      csrfToken: newCsrfToken,
      expiresAt: sessionExpiresAt.toISOString(),
    };
  }

  async logout({ sessionId, userId, requestId }) {
    await this.authRepository.revokeSession(sessionId);
    await this.authRepository
      .recordSecurityAuditEvent({
        eventType: 'SESSION_REVOKED',
        requestId,
        actorId: userId,
        outcome: 'SUCCESS',
        metadata: { reason: 'logout' },
      })
      .catch(() => {});
  }
}

module.exports = {
  AuthService,
  computePkceChallenge,
  REGISTER_ACCEPTED_MESSAGE,
  VERIFY_EMAIL_SUCCESS_MESSAGE,
  FORGOT_PASSWORD_ACCEPTED_MESSAGE,
  RESET_PASSWORD_SUCCESS_MESSAGE,
};
