const { config } = require('../config/env');
const { verifySessionJwt, sha256Hex, constantTimeEqual } = require('../config/crypto');
const { AppError } = require('../config/errors');

function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  const normalized = origin.trim().replace(/\/+$/, '');
  if (!normalized || normalized === 'null') return false;
  if (config.allowedOrigins.includes(normalized)) return true;
  if (!config.isProduction && !config.isTest) {
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(normalized);
  }
  return false;
}

function createAuthMiddleware(authRepository) {
  async function resolveSession(req, required = true) {
    const token = req.cookies?.[config.cookies.sessionName];
    if (!token) {
      if (required) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.');
      }
      return null;
    }

    let claims;
    try {
      claims = verifySessionJwt(token);
    } catch (_) {
      if (required) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired session token.');
      }
      return null;
    }

    let sessionRecord;
    try {
      sessionRecord = await authRepository.findActiveSessionWithUser(claims.sid);
    } catch (_) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Session verification is temporarily unavailable.');
    }

    const now = new Date();
    if (
      !sessionRecord ||
      sessionRecord.userId !== claims.sub ||
      sessionRecord.revokedAt !== null ||
      new Date(sessionRecord.expiresAt) <= now ||
      !sessionRecord.user
    ) {
      if (required) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Session is expired or revoked.');
      }
      return null;
    }

    req.auth = {
      sessionId: sessionRecord.id,
      userId: sessionRecord.user.id,
      csrfTokenHash: sessionRecord.csrfTokenHash,
      sessionCreatedAt: new Date(sessionRecord.createdAt),
      sessionExpiresAt: new Date(sessionRecord.expiresAt),
      user: {
        id: sessionRecord.user.id,
        email: sessionRecord.user.email,
        displayName: sessionRecord.user.displayName,
        role: sessionRecord.user.role,
      },
      // SEC-001: Admin routes require verified MFA assurance in production and test.
      // In local development (no external MFA broker configured), authenticated ADMIN sessions are granted dev MFA assurance unless DEV_ADMIN_MFA_ASSURANCE=false.
      mfaVerified:
        Boolean(sessionRecord.mfaVerified) ||
        (config.nodeEnv === 'development' &&
          sessionRecord.user.role === 'ADMIN' &&
          process.env.DEV_ADMIN_MFA_ASSURANCE !== 'false'),
    };

    return req.auth;
  }

  async function requireAuth(req, res, next) {
    try {
      await resolveSession(req, true);
      next();
    } catch (err) {
      next(err);
    }
  }

  async function optionalAuth(req, res, next) {
    try {
      await resolveSession(req, false);
      next();
    } catch (err) {
      next(err);
    }
  }

  function requireCsrfAndOrigin(req, res, next) {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      return next(new AppError(403, 'CSRF_INVALID', 'Invalid or missing Origin header.'));
    }

    const csrfHeader = req.headers['x-csrf-token'];
    if (!csrfHeader || typeof csrfHeader !== 'string' || !req.auth?.csrfTokenHash) {
      return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token.'));
    }

    const headerHash = sha256Hex(csrfHeader);
    if (!constantTimeEqual(headerHash, req.auth.csrfTokenHash)) {
      return next(new AppError(403, 'CSRF_INVALID', 'CSRF token mismatch.'));
    }

    return next();
  }

  function requireOriginOnly(req, res, next) {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      return next(new AppError(403, 'ORIGIN_FORBIDDEN', 'Origin is not allowed.'));
    }
    return next();
  }

  function requirePreauthCsrfAndOrigin(req, res, next) {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      return next(new AppError(403, 'CSRF_INVALID', 'Invalid or missing Origin header.'));
    }

    const cookieToken = req.cookies?.[config.cookies.preauthName];
    const headerToken = req.headers['x-csrf-token'];
    if (
      !cookieToken ||
      typeof cookieToken !== 'string' ||
      !headerToken ||
      typeof headerToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(cookieToken) ||
      !constantTimeEqual(cookieToken, headerToken)
    ) {
      return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid preauth CSRF token.'));
    }

    return next();
  }

  function requireAdmin({ requireRecentAuth = false } = {}) {
    return (req, res, next) => {
      if (!req.auth?.user) {
        return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
      }
      if (req.auth.user.role !== 'ADMIN') {
        return next(new AppError(403, 'FORBIDDEN', 'Administrator role is required.'));
      }
      // SEC-001: Admin routes require verified MFA assurance.
      // Production broker integration is an open release gate; synthetic local test sessions may set mfaVerified.
      if (!req.auth.mfaVerified) {
        return next(
          new AppError(
            403,
            'FORBIDDEN',
            'Verified MFA assurance is required for administrator access.'
          )
        );
      }
      if (requireRecentAuth) {
        const ageMs = Date.now() - req.auth.sessionCreatedAt.getTime();
        if (ageMs > 5 * 60 * 1000) {
          return next(
            new AppError(
              403,
              'FORBIDDEN',
              'Recent authentication (within 5 minutes) is required for administrator mutations.'
            )
          );
        }
      }
      return next();
    };
  }

  return {
    requireAuth,
    optionalAuth,
    requireCsrfAndOrigin,
    requirePreauthCsrfAndOrigin,
    requireOriginOnly,
    requireAdmin,
  };
}

module.exports = {
  createAuthMiddleware,
  isAllowedOrigin,
};
