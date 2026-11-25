const express = require('express');
const { AppError } = require('../../config/errors');
const { validateUuidParam, requireEmptyQuery } = require('../../middleware/validate');
const { createRateLimitMiddleware } = require('../../middleware/rateLimit');
const { methodNotAllowed } = require('../../middleware/errorHandler');
const { parseCatalogQuery } = require('./products.validator');

function createProductsRouter({ productsRepository, rateLimiter }) {
  const router = express.Router();

  const catalogIpLimit = createRateLimitMiddleware({
    name: 'catalog_ip',
    limit: 120,
    limiter: rateLimiter,
  });

  router.get('/', catalogIpLimit, async (req, res, next) => {
    try {
      const filters = parseCatalogQuery(req.query, { allowActiveFilter: false });
      const result = await productsRepository.listProducts({
        ...filters,
        active: true,
      });
      res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  });
  router.all('/', methodNotAllowed(['GET']));

  router.get(
    '/:productId',
    catalogIpLimit,
    requireEmptyQuery,
    validateUuidParam('productId'),
    async (req, res, next) => {
      try {
        const product = await productsRepository.findById(req.params.productId, { activeOnly: true });
        if (!product) {
          throw new AppError(404, 'NOT_FOUND', 'Product not found.');
        }
        res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
        return res.status(200).json({ data: product });
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/:productId', methodNotAllowed(['GET']));

  return router;
}

module.exports = { createProductsRouter };
