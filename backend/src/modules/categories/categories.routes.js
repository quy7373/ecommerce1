const express = require('express');
const { requireEmptyQuery } = require('../../middleware/validate');
const { createRateLimitMiddleware } = require('../../middleware/rateLimit');
const { methodNotAllowed } = require('../../middleware/errorHandler');

function createCategoriesRouter({ categoriesRepository, rateLimiter }) {
  const router = express.Router();

  const catalogIpLimit = createRateLimitMiddleware({
    name: 'catalog_ip',
    limit: 120,
    limiter: rateLimiter,
  });

  let cachedCategories = null;
  let cacheExpiresAt = 0;
  const CACHE_TTL_MS = 60_000;

  router.get('/', catalogIpLimit, requireEmptyQuery, async (req, res, next) => {
    try {
      const now = Date.now();
      if (!cachedCategories || now >= cacheExpiresAt) {
        cachedCategories = await categoriesRepository.listAll();
        cacheExpiresAt = now + CACHE_TTL_MS;
      }
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.status(200).json({ data: cachedCategories });
    } catch (err) {
      return next(err);
    }
  });
  router.all('/', methodNotAllowed(['GET']));

  return router;
}

module.exports = { createCategoriesRouter };
