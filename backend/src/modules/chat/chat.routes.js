const express = require('express');
const { z } = require('zod');
const { noStoreMiddleware } = require('../../middleware/requestContext');
const { nfcString, requireEmptyQuery, validateBody } = require('../../middleware/validate');
const { createRateLimitMiddleware, getClientIp } = require('../../middleware/rateLimit');
const { methodNotAllowed } = require('../../middleware/errorHandler');

const supportMessageSchema = z
  .object({
    message: nfcString(1, 2000, 'Message'),
  })
  .strict();

function createChatRouter({ chatService, authMiddleware, rateLimiter }) {
  const router = express.Router();
  router.use(noStoreMiddleware);

  const supportIpLimit = createRateLimitMiddleware({
    name: 'support_ip',
    limit: 10,
    limiter: rateLimiter,
  });

  const supportUserLimit = createRateLimitMiddleware({
    name: 'support_user',
    limit: 10,
    keyFn: (req) => req.auth?.userId || null,
    limiter: rateLimiter,
  });

  router.post(
    '/messages',
    requireEmptyQuery,
    authMiddleware.requireOriginOnly,
    supportIpLimit,
    authMiddleware.optionalAuth,
    supportUserLimit,
    validateBody(supportMessageSchema),
    async (req, res, next) => {
      try {
        const result = await chatService.answerMessage({
          message: req.validatedBody.message,
          ipKey: getClientIp(req),
        });
        return res.status(200).json({ data: result });
      } catch (err) {
        return next(err);
      }
    }
  );
  router.all('/messages', methodNotAllowed(['POST']));

  return router;
}

module.exports = { createChatRouter };
