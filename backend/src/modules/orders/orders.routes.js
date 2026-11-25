const express = require('express');
const { z } = require('zod');
const { validationError } = require('../../config/errors');
const { noStoreMiddleware } = require('../../middleware/requestContext');
const {
  versionSchema,
  addressSchema,
  validateUuidParam,
  validateIdempotencyKeyHeader,
  requireEmptyQuery,
  validateBody,
  parseQueryInt,
} = require('../../middleware/validate');
const { createRateLimitMiddleware } = require('../../middleware/rateLimit');
const { methodNotAllowed } = require('../../middleware/errorHandler');

const ORDER_STATUSES = new Set([
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'CANCELLED',
  'EXPIRED',
  'PAYMENT_REVIEW',
]);

const createOrderSchema = z
  .object({
    cartVersion: versionSchema,
    shippingAddress: addressSchema,
  })
  .strict();

const emptyObjectSchema = z.object({}).strict();

function parseOrderListQuery(rawQuery) {
  const allowedKeys = new Set(['page', 'pageSize', 'status']);
  const details = [];
  for (const k of Object.keys(rawQuery || {})) {
    if (!allowedKeys.has(k)) {
      details.push({ field: `query.${k}`, code: 'UNKNOWN_FIELD', message: 'Unknown query parameter.' });
    }
  }
  let page = 1;
  if (rawQuery.page !== undefined) {
    const parsed = parseQueryInt(rawQuery.page, 'page', 1, 100_000);
    if (parsed.error) details.push(parsed.error);
    else page = parsed.value;
  }
  let pageSize = 20;
  if (rawQuery.pageSize !== undefined) {
    const parsed = parseQueryInt(rawQuery.pageSize, 'pageSize', 1, 100);
    if (parsed.error) details.push(parsed.error);
    else pageSize = parsed.value;
  }
  let status = undefined;
  if (rawQuery.status !== undefined) {
    if (typeof rawQuery.status !== 'string' || !ORDER_STATUSES.has(rawQuery.status)) {
      details.push({ field: 'query.status', code: 'FORMAT', message: 'Invalid order status.' });
    } else {
      status = rawQuery.status;
    }
  }
  if (details.length > 0) throw validationError(details);
  return { page, pageSize, status };
}

function createOrdersRouter({ ordersService, authMiddleware, rateLimiter }) {
  const router = express.Router();
  router.use(noStoreMiddleware);

  const authReadUserLimit = createRateLimitMiddleware({
    name: 'auth_read_user',
    limit: 120,
    keyFn: (req) => req.auth?.userId,
    limiter: rateLimiter,
  });

  const orderCreateUserLimit = createRateLimitMiddleware({
    name: 'order_create_user',
    limit: 5,
    keyFn: (req) => req.auth?.userId,
    limiter: rateLimiter,
  });

  const authMutUserLimit = createRateLimitMiddleware({
    name: 'auth_mut_user',
    limit: 60,
    keyFn: (req) => req.auth?.userId,
    limiter: rateLimiter,
  });

  router.get('/', authMiddleware.requireAuth, authReadUserLimit, async (req, res, next) => {
    try {
      const filters = parseOrderListQuery(req.query);
      const result = await ordersService.listOrders({
        userId: req.auth.userId,
        ...filters,
      });
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  });

  router.post(
    '/',
    requireEmptyQuery,
    authMiddleware.requireAuth,
    authMiddleware.requireCsrfAndOrigin,
    orderCreateUserLimit,
    validateIdempotencyKeyHeader,
    validateBody(createOrderSchema),
    async (req, res, next) => {
      try {
        const result = await ordersService.createOrder({
          userId: req.auth.userId,
          idempotencyKey: req.idempotencyKey,
          cartVersion: req.validatedBody.cartVersion,
          shippingAddress: req.validatedBody.shippingAddress,
        });
        if (result.resourceId) {
          res.setHeader('Location', `/api/v1/orders/${result.resourceId}`);
        }
        return res.status(result.status).json(result.body);
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/', methodNotAllowed(['GET', 'POST']));

  router.get(
    '/:orderId',
    requireEmptyQuery,
    validateUuidParam('orderId'),
    authMiddleware.requireAuth,
    authReadUserLimit,
    async (req, res, next) => {
      try {
        const order = await ordersService.getOrder({
          orderId: req.params.orderId,
          userId: req.auth.userId,
        });
        return res.status(200).json({ data: order });
      } catch (err) {
        return next(err);
      }
    }
  );
  router.delete(
    '/:orderId',
    requireEmptyQuery,
    validateUuidParam('orderId'),
    authMiddleware.requireAuth,
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    async (req, res, next) => {
      try {
        await ordersService.deleteOrder({
          orderId: req.params.orderId,
          userId: req.auth.userId,
        });
        return res.status(204).send();
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/:orderId', methodNotAllowed(['GET', 'DELETE']));

  router.post(
    '/:orderId/cancel',
    requireEmptyQuery,
    validateUuidParam('orderId'),
    authMiddleware.requireAuth,
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    validateBody(emptyObjectSchema),
    async (req, res, next) => {
      try {
        const result = await ordersService.cancelOrder({
          orderId: req.params.orderId,
          userId: req.auth.userId,
        });
        return res.status(result.statusCode).json({ data: result.data });
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/:orderId/cancel', methodNotAllowed(['POST']));

  return router;
}

module.exports = {
  createOrdersRouter,
  parseOrderListQuery,
  ORDER_STATUSES,
};
