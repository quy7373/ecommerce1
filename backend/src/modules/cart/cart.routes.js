const express = require('express');
const { z } = require('zod');
const { noStoreMiddleware } = require('../../middleware/requestContext');
const {
  uuidSchema,
  qtySchema,
  versionSchema,
  validateUuidParam,
  requireEmptyQuery,
  validateBody,
} = require('../../middleware/validate');
const { createRateLimitMiddleware } = require('../../middleware/rateLimit');
const { methodNotAllowed } = require('../../middleware/errorHandler');

const addCartItemSchema = z
  .object({
    productId: uuidSchema,
    quantity: qtySchema,
    cartVersion: versionSchema,
  })
  .strict();

const updateCartItemSchema = z
  .object({
    quantity: qtySchema,
    cartVersion: versionSchema,
  })
  .strict();

const removeCartItemSchema = z
  .object({
    cartVersion: versionSchema,
  })
  .strict();

function createCartRouter({ cartService, authMiddleware, rateLimiter }) {
  const router = express.Router();
  router.use(noStoreMiddleware);

  const authReadUserLimit = createRateLimitMiddleware({
    name: 'auth_read_user',
    limit: 120,
    keyFn: (req) => req.auth?.userId,
    limiter: rateLimiter,
  });

  const authMutUserLimit = createRateLimitMiddleware({
    name: 'auth_mut_user',
    limit: 60,
    keyFn: (req) => req.auth?.userId,
    limiter: rateLimiter,
  });

  router.get(
    '/',
    requireEmptyQuery,
    authMiddleware.requireAuth,
    authReadUserLimit,
    async (req, res, next) => {
      try {
        const cart = await cartService.getCart(req.auth.userId);
        return res.status(200).json({ data: cart });
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/', methodNotAllowed(['GET']));

  router.post(
    '/items',
    requireEmptyQuery,
    authMiddleware.requireAuth,
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    validateBody(addCartItemSchema),
    async (req, res, next) => {
      try {
        const cart = await cartService.addItem(req.auth.userId, req.validatedBody);
        return res.status(200).json({ data: cart });
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/items', methodNotAllowed(['POST']));

  router.patch(
    '/items/:productId',
    requireEmptyQuery,
    validateUuidParam('productId'),
    authMiddleware.requireAuth,
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    validateBody(updateCartItemSchema),
    async (req, res, next) => {
      try {
        const cart = await cartService.updateItem(
          req.auth.userId,
          req.params.productId,
          req.validatedBody
        );
        return res.status(200).json({ data: cart });
      } catch (err) {
        return next(err);
      }
    }
  );

  router.delete(
    '/items/:productId',
    requireEmptyQuery,
    validateUuidParam('productId'),
    authMiddleware.requireAuth,
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    validateBody(removeCartItemSchema),
    async (req, res, next) => {
      try {
        const cart = await cartService.removeItem(
          req.auth.userId,
          req.params.productId,
          req.validatedBody
        );
        return res.status(200).json({ data: cart });
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/items/:productId', methodNotAllowed(['PATCH', 'DELETE']));

  return router;
}

module.exports = { createCartRouter };
