const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../config/errors');
const { noStoreMiddleware } = require('../../middleware/requestContext');
const {
  uuidSchema,
  requireEmptyQuery,
  validateIdempotencyKeyHeader,
  validateBody,
} = require('../../middleware/validate');
const { createRateLimitMiddleware } = require('../../middleware/rateLimit');
const { methodNotAllowed } = require('../../middleware/errorHandler');

const createCheckoutSchema = z
  .object({
    orderId: uuidSchema,
  })
  .strict();

function createCheckoutRouter({ paymentsService, authMiddleware, rateLimiter }) {
  const router = express.Router();
  router.use(noStoreMiddleware);

  const checkoutUserLimit = createRateLimitMiddleware({
    name: 'checkout_create_user',
    limit: 5,
    keyFn: (req) => req.auth?.userId,
    limiter: rateLimiter,
  });

  const checkoutOrderLimit = createRateLimitMiddleware({
    name: 'checkout_create_order',
    limit: 3,
    keyFn: (req) => req.validatedBody?.orderId,
    limiter: rateLimiter,
  });

  router.post(
    '/sessions',
    requireEmptyQuery,
    authMiddleware.requireAuth,
    authMiddleware.requireCsrfAndOrigin,
    checkoutUserLimit,
    validateIdempotencyKeyHeader,
    validateBody(createCheckoutSchema),
    checkoutOrderLimit,
    async (req, res, next) => {
      try {
        const result = await paymentsService.createCheckoutSession({
          userId: req.auth.userId,
          orderId: req.validatedBody.orderId,
          idempotencyKey: req.idempotencyKey,
        });
        return res.status(result.status).json(result.body);
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/sessions', methodNotAllowed(['POST']));

  return router;
}

function createWebhookRouter({ paymentsService }) {
  const router = express.Router();
  router.use(noStoreMiddleware);

  // Raw body middleware (1 MiB ceiling) mounted BEFORE any JSON parser
  router.post(
    '/stripe',
    express.raw({ type: 'application/json', limit: '1mb' }),
    (err, req, res, next) => {
      if (err && err.type === 'entity.too.large') {
        return next(new AppError(413, 'PAYLOAD_TOO_LARGE', 'Webhook payload exceeds 1 MiB limit.'));
      }
      if (err) {
        return next(new AppError(400, 'WEBHOOK_INVALID', 'Malformed webhook payload.'));
      }
      return next();
    },
    async (req, res, next) => {
      try {
        if (!Buffer.isBuffer(req.body)) {
          throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Webhook Content-Type must be application/json.');
        }
        const signatureHeader = req.headers['stripe-signature'];
        await paymentsService.ingestStripeWebhook({
          rawBody: req.body,
          signatureHeader,
        });
        return res.status(200).json({ received: true });
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/stripe', methodNotAllowed(['POST']));

  return router;
}

module.exports = {
  createCheckoutRouter,
  createWebhookRouter,
};
