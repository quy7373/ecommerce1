const express = require('express');
const { z } = require('zod');
const { config } = require('../../config/env');
const { noStoreMiddleware } = require('../../middleware/requestContext');
const { requireEmptyQuery, validateBody } = require('../../middleware/validate');
const { createRateLimitMiddleware } = require('../../middleware/rateLimit');
const { methodNotAllowed } = require('../../middleware/errorHandler');
const {
  registerBodySchema,
  verifyEmailBodySchema,
  loginBodySchema,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
} = require('./auth.validator');

const emptyObjectSchema = z.object({}).strict();

function cookieBaseOptions() {
  return {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    path: config.cookies.path,
  };
}

function createAuthRouter({ authService, authMiddleware, rateLimiter }) {
  const router = express.Router();
  router.use(noStoreMiddleware);

  const authIpLimit = createRateLimitMiddleware({
    name: 'auth_ip',
    limit: 20,
    limiter: rateLimiter,
  });

  const csrfIpLimit = createRateLimitMiddleware({
    name: 'auth_csrf_ip',
    limit: 30,
    limiter: rateLimiter,
  });

  const registerIpLimit = createRateLimitMiddleware({
    name: 'auth_register_ip',
    limit: 10,
    limiter: rateLimiter,
  });

  const verifyIpLimit = createRateLimitMiddleware({
    name: 'auth_verify_ip',
    limit: 10,
    limiter: rateLimiter,
  });

  const loginIpLimit = createRateLimitMiddleware({
    name: 'auth_login_ip',
    limit: 20,
    limiter: rateLimiter,
  });

  const forgotIpLimit = createRateLimitMiddleware({
    name: 'auth_forgot_ip',
    limit: 10,
    limiter: rateLimiter,
  });

  const resetIpLimit = createRateLimitMiddleware({
    name: 'auth_reset_ip',
    limit: 10,
    limiter: rateLimiter,
  });

  // GET /api/v1/auth/csrf — issue preauth CSRF cookie + token
  router.get('/csrf', csrfIpLimit, requireEmptyQuery, (req, res, next) => {
    try {
      const { csrfToken, expiresAt } = authService.issuePreauthCsrf();
      res.cookie(config.cookies.preauthName, csrfToken, {
        ...cookieBaseOptions(),
        maxAge: config.cookies.preauthMaxAgeSec * 1000,
      });
      return res.status(200).json({ csrfToken, expiresAt });
    } catch (err) {
      return next(err);
    }
  });
  router.all('/csrf', methodNotAllowed(['GET']));

  // POST /api/v1/auth/register
  router.post(
    '/register',
    registerIpLimit,
    requireEmptyQuery,
    authMiddleware.requirePreauthCsrfAndOrigin,
    validateBody(registerBodySchema),
    async (req, res, next) => {
      try {
        if (req.validatedBody.displayName && req.validatedBody.password) {
          const result = await authService.registerWithPassword({
            email: req.validatedBody.email,
            displayName: req.validatedBody.displayName,
            password: req.validatedBody.password,
            requestId: req.requestId,
          });
          return res.status(201).json(result);
        }
        const result = await authService.requestRegistration({
          email: req.validatedBody.email,
          requestId: req.requestId,
        });
        return res.status(202).json(result);
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/register', methodNotAllowed(['POST']));

  // POST /api/v1/auth/verify-email
  router.post(
    '/verify-email',
    verifyIpLimit,
    requireEmptyQuery,
    authMiddleware.requirePreauthCsrfAndOrigin,
    validateBody(verifyEmailBodySchema),
    async (req, res, next) => {
      try {
        const result = await authService.verifyEmailRegistration({
          token: req.validatedBody.token,
          displayName: req.validatedBody.displayName,
          password: req.validatedBody.password,
          requestId: req.requestId,
        });
        return res.status(201).json(result);
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/verify-email', methodNotAllowed(['POST']));

  // POST /api/v1/auth/login
  router.post(
    '/login',
    loginIpLimit,
    requireEmptyQuery,
    authMiddleware.requirePreauthCsrfAndOrigin,
    validateBody(loginBodySchema),
    authMiddleware.optionalAuth,
    async (req, res, next) => {
      try {
        const { jwtToken, body } = await authService.loginWithPassword({
          email: req.validatedBody.email,
          password: req.validatedBody.password,
          existingSessionId: req.auth?.sessionId || null,
          requestId: req.requestId,
        });
        res.cookie(config.cookies.sessionName, jwtToken, {
          ...cookieBaseOptions(),
          maxAge: config.cookies.sessionMaxAgeSec * 1000,
        });
        return res.status(200).json(body);
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/login', methodNotAllowed(['POST']));

  // POST /api/v1/auth/forgot-password
  router.post(
    '/forgot-password',
    forgotIpLimit,
    requireEmptyQuery,
    authMiddleware.requirePreauthCsrfAndOrigin,
    validateBody(forgotPasswordBodySchema),
    async (req, res, next) => {
      try {
        const result = await authService.requestPasswordReset({
          email: req.validatedBody.email,
          requestId: req.requestId,
        });
        return res.status(202).json(result);
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/forgot-password', methodNotAllowed(['POST']));

  // POST /api/v1/auth/reset-password
  router.post(
    '/reset-password',
    resetIpLimit,
    requireEmptyQuery,
    authMiddleware.requirePreauthCsrfAndOrigin,
    validateBody(resetPasswordBodySchema),
    async (req, res, next) => {
      try {
        const result = await authService.resetPassword({
          token: req.validatedBody.token,
          password: req.validatedBody.password,
          requestId: req.requestId,
        });
        res.clearCookie(config.cookies.sessionName, cookieBaseOptions());
        return res.status(200).json(result);
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/reset-password', methodNotAllowed(['POST']));

  // Existing Google OIDC routes
  router.get('/google', authIpLimit, requireEmptyQuery, async (req, res, next) => {
    try {
      const { redirectUrl, browserBinding } = await authService.startGoogleLogin({
        requestId: req.requestId,
      });
      res.cookie(config.cookies.oauthName, browserBinding, {
        ...cookieBaseOptions(),
        maxAge: config.cookies.oauthMaxAgeSec * 1000,
      });
      return res.redirect(302, redirectUrl);
    } catch (err) {
      return next(err);
    }
  });
  router.all('/google', methodNotAllowed(['GET']));

  router.get('/google/callback', authIpLimit, authMiddleware.optionalAuth, async (req, res, next) => {
    try {
      const browserBindingCookie = req.cookies?.[config.cookies.oauthName];
      const { jwtToken, redirectUrl } = await authService.handleGoogleCallback({
        query: req.query,
        browserBindingCookie,
        existingSessionId: req.auth?.sessionId || null,
        requestId: req.requestId,
      });

      res.clearCookie(config.cookies.oauthName, cookieBaseOptions());

      res.cookie(config.cookies.sessionName, jwtToken, {
        ...cookieBaseOptions(),
        maxAge: config.cookies.sessionMaxAgeSec * 1000,
      });

      return res.redirect(302, redirectUrl);
    } catch (err) {
      res.clearCookie(config.cookies.oauthName, cookieBaseOptions());
      return next(err);
    }
  });
  router.all('/google/callback', methodNotAllowed(['GET']));

  router.get('/session', requireEmptyQuery, authMiddleware.requireAuth, async (req, res, next) => {
    try {
      const payload = await authService.getSessionAndRotateCsrf({
        sessionId: req.auth.sessionId,
        user: req.auth.user,
        sessionExpiresAt: req.auth.sessionExpiresAt,
      });
      return res.status(200).json(payload);
    } catch (err) {
      return next(err);
    }
  });
  router.all('/session', methodNotAllowed(['GET']));

  router.post(
    '/logout',
    requireEmptyQuery,
    authMiddleware.requireAuth,
    authMiddleware.requireCsrfAndOrigin,
    validateBody(emptyObjectSchema),
    async (req, res, next) => {
      try {
        await authService.logout({
          sessionId: req.auth.sessionId,
          userId: req.auth.userId,
          requestId: req.requestId,
        });
        res.clearCookie(config.cookies.sessionName, cookieBaseOptions());
        return res.status(204).send();
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/logout', methodNotAllowed(['POST']));

  return router;
}

module.exports = { createAuthRouter };
