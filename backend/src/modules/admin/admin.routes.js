const express = require('express');
const { z } = require('zod');
const { validationError } = require('../../config/errors');
const { noStoreMiddleware } = require('../../middleware/requestContext');
const {
  SKU_REGEX,
  normalizeText,
  nfcString,
  uuidSchema,
  positivePriceSchema,
  versionSchema,
  addressSchema,
  validateUuidParam,
  requireEmptyQuery,
  validateBody,
} = require('../../middleware/validate');
const { createRateLimitMiddleware } = require('../../middleware/rateLimit');
const { methodNotAllowed } = require('../../middleware/errorHandler');
const { parseCatalogQuery } = require('../products/products.validator');
const { parseOrderListQuery } = require('../orders/orders.routes');

const skuSchema = z
  .string()
  .transform(normalizeText)
  .refine((v) => SKU_REGEX.test(v), {
    message: 'SKU must be 1..64 uppercase [A-Z0-9_-] characters.',
  });

const createProductSchema = z
  .object({
    sku: skuSchema,
    name: nfcString(1, 200, 'Product name'),
    description: nfcString(0, 5000, 'Description'),
    categoryId: uuidSchema,
    price: positivePriceSchema,
    imageUrl: z.string().max(2048).nullable(),
    stockOnHand: z.number().int().min(0).max(1_000_000),
    active: z.boolean(),
  })
  .strict();

const updateProductSchema = z
  .object({
    sku: skuSchema.optional(),
    name: nfcString(1, 200, 'Product name').optional(),
    description: nfcString(0, 5000, 'Description').optional(),
    categoryId: uuidSchema.optional(),
    price: positivePriceSchema.optional(),
    imageUrl: z.string().max(2048).nullable().optional(),
    stockOnHand: z.number().int().min(0).max(1_000_000).optional(),
    active: z.boolean().optional(),
    version: versionSchema,
  })
  .strict()
  .refine(
    (obj) =>
      Object.keys(obj).some((k) => k !== 'version'),
    { message: 'At least one updatable product field must be provided.' }
  );

const archiveProductSchema = z
  .object({
    version: versionSchema,
  })
  .strict();

const updateOrderStatusSchema = z
  .object({
    status: z.enum(['PROCESSING', 'SHIPPED']),
    version: versionSchema,
  })
  .strict();

const adminOrderStatusEnum = z.enum([
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'CANCELLED',
  'EXPIRED',
  'PAYMENT_REVIEW',
]);

const createAdminOrderSchema = z
  .object({
    customerEmail: z.string().trim().email('Valid customer email is required.').max(254).optional(),
    items: z
      .array(
        z
          .object({
            productId: uuidSchema,
            quantity: z.number().int().min(1).max(99),
          })
          .strict()
      )
      .min(1, 'At least one item is required.')
      .max(50),
    shippingAddress: addressSchema,
  })
  .strict();

const updateAdminOrderSchema = z
  .object({
    status: adminOrderStatusEnum.optional(),
    shippingAddress: addressSchema.optional(),
    version: versionSchema,
  })
  .strict()
  .refine((obj) => obj.status !== undefined || obj.shippingAddress !== undefined, {
    message: 'At least status or shippingAddress must be provided.',
  });

const deleteAdminOrderSchema = z
  .object({
    version: versionSchema,
  })
  .strict();

function createAdminRouter({ adminService, authMiddleware, rateLimiter }) {
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

  // --- Admin Orders ---
  router.get(
    '/orders',
    authMiddleware.requireAuth,
    authMiddleware.requireAdmin({ requireRecentAuth: false }),
    authReadUserLimit,
    async (req, res, next) => {
      try {
        const filters = parseOrderListQuery(req.query);
        const result = await adminService.listOrders(filters);
        return res.status(200).json(result);
      } catch (err) {
        return next(err);
      }
    }
  );
  router.post(
    '/orders',
    requireEmptyQuery,
    authMiddleware.requireAuth,
    authMiddleware.requireAdmin({ requireRecentAuth: true }),
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    validateBody(createAdminOrderSchema),
    async (req, res, next) => {
      try {
        const created = await adminService.createOrder({
          data: req.validatedBody,
          actorId: req.auth.userId,
          requestId: req.requestId,
        });
        res.setHeader('Location', `/api/v1/admin/orders/${created.id}`);
        return res.status(201).json({ data: created });
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/orders', methodNotAllowed(['GET', 'POST']));

  router.get(
    '/orders/:orderId',
    requireEmptyQuery,
    validateUuidParam('orderId'),
    authMiddleware.requireAuth,
    authMiddleware.requireAdmin({ requireRecentAuth: false }),
    authReadUserLimit,
    async (req, res, next) => {
      try {
        const order = await adminService.getOrder(req.params.orderId);
        return res.status(200).json({ data: order });
      } catch (err) {
        return next(err);
      }
    }
  );

  router.patch(
    '/orders/:orderId',
    requireEmptyQuery,
    validateUuidParam('orderId'),
    authMiddleware.requireAuth,
    authMiddleware.requireAdmin({ requireRecentAuth: true }),
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    validateBody(updateAdminOrderSchema),
    async (req, res, next) => {
      try {
        const updated = await adminService.updateOrder({
          orderId: req.params.orderId,
          data: req.validatedBody,
          actorId: req.auth.userId,
          requestId: req.requestId,
        });
        return res.status(200).json({ data: updated });
      } catch (err) {
        return next(err);
      }
    }
  );

  router.delete(
    '/orders/:orderId',
    requireEmptyQuery,
    validateUuidParam('orderId'),
    authMiddleware.requireAuth,
    authMiddleware.requireAdmin({ requireRecentAuth: true }),
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    validateBody(deleteAdminOrderSchema),
    async (req, res, next) => {
      try {
        await adminService.deleteOrder({
          orderId: req.params.orderId,
          version: req.validatedBody.version,
          actorId: req.auth.userId,
          requestId: req.requestId,
        });
        return res.status(204).send();
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/orders/:orderId', methodNotAllowed(['GET', 'PATCH', 'DELETE']));

  router.patch(
    '/orders/:orderId/status',
    requireEmptyQuery,
    validateUuidParam('orderId'),
    authMiddleware.requireAuth,
    authMiddleware.requireAdmin({ requireRecentAuth: true }),
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    validateBody(updateOrderStatusSchema),
    async (req, res, next) => {
      try {
        const updated = await adminService.updateOrderStatus({
          orderId: req.params.orderId,
          status: req.validatedBody.status,
          version: req.validatedBody.version,
          actorId: req.auth.userId,
          requestId: req.requestId,
        });
        return res.status(200).json({ data: updated });
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/orders/:orderId/status', methodNotAllowed(['PATCH']));

  // --- Admin Products ---
  router.get(
    '/products',
    authMiddleware.requireAuth,
    authMiddleware.requireAdmin({ requireRecentAuth: false }),
    authReadUserLimit,
    async (req, res, next) => {
      try {
        const filters = parseCatalogQuery(req.query, { allowActiveFilter: true });
        const result = await adminService.listProducts(filters);
        return res.status(200).json(result);
      } catch (err) {
        return next(err);
      }
    }
  );

  router.post(
    '/products',
    requireEmptyQuery,
    authMiddleware.requireAuth,
    authMiddleware.requireAdmin({ requireRecentAuth: true }),
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    validateBody(createProductSchema),
    async (req, res, next) => {
      try {
        const created = await adminService.createProduct({
          data: req.validatedBody,
          actorId: req.auth.userId,
          requestId: req.requestId,
        });
        res.setHeader('Location', `/api/v1/admin/products/${created.id}`);
        return res.status(201).json({ data: created });
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/products', methodNotAllowed(['GET', 'POST']));

  router.get(
    '/products/:productId',
    requireEmptyQuery,
    validateUuidParam('productId'),
    authMiddleware.requireAuth,
    authMiddleware.requireAdmin({ requireRecentAuth: false }),
    authReadUserLimit,
    async (req, res, next) => {
      try {
        const product = await adminService.getProduct(req.params.productId);
        return res.status(200).json({ data: product });
      } catch (err) {
        return next(err);
      }
    }
  );

  router.patch(
    '/products/:productId',
    requireEmptyQuery,
    validateUuidParam('productId'),
    authMiddleware.requireAuth,
    authMiddleware.requireAdmin({ requireRecentAuth: true }),
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    validateBody(updateProductSchema),
    async (req, res, next) => {
      try {
        const updated = await adminService.updateProduct({
          productId: req.params.productId,
          data: req.validatedBody,
          actorId: req.auth.userId,
          requestId: req.requestId,
        });
        return res.status(200).json({ data: updated });
      } catch (err) {
        return next(err);
      }
    }
  );

  router.delete(
    '/products/:productId',
    requireEmptyQuery,
    validateUuidParam('productId'),
    authMiddleware.requireAuth,
    authMiddleware.requireAdmin({ requireRecentAuth: true }),
    authMiddleware.requireCsrfAndOrigin,
    authMutUserLimit,
    validateBody(archiveProductSchema),
    async (req, res, next) => {
      try {
        await adminService.archiveProduct({
          productId: req.params.productId,
          version: req.validatedBody.version,
          actorId: req.auth.userId,
          requestId: req.requestId,
        });
        return res.status(204).send();
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/products/:productId', methodNotAllowed(['GET', 'PATCH', 'DELETE']));

  return router;
}

module.exports = { createAdminRouter };
