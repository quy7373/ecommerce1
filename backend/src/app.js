const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');

const { config } = require('./config/env');
const { getPrismaClient } = require('./config/prisma');
const { AppError } = require('./config/errors');
const { openApiSpec } = require('./config/swagger');

const {
  requestIdMiddleware,
  securityHeadersMiddleware,
  noStoreMiddleware,
} = require('./middleware/requestContext');
const {
  strictJsonBodyMiddleware,
  rejectDuplicateQueryParams,
} = require('./middleware/jsonParser');
const { createAuthMiddleware, isAllowedOrigin } = require('./middleware/auth');
const { SlidingWindowRateLimiter } = require('./middleware/rateLimit');
const { methodNotAllowed, notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const { StripeClient } = require('./integrations/stripe/stripe.client');
const { LlmClient } = require('./integrations/llm/llm.client');
const { createMailAdapter } = require('./integrations/mail/mail.adapter');

const { AuthRepository } = require('./modules/auth/auth.repository');
const { PasswordService } = require('./modules/auth/password.service');
const { AuthMailWorker } = require('./modules/auth/authMail.worker');
const { AuthService } = require('./modules/auth/auth.service');
const { createAuthRouter } = require('./modules/auth/auth.routes');

const { CategoriesRepository } = require('./modules/categories/categories.repository');
const { createCategoriesRouter } = require('./modules/categories/categories.routes');

const { ProductsRepository } = require('./modules/products/products.repository');
const { createProductsRouter } = require('./modules/products/products.routes');

const { CartService } = require('./modules/cart/cart.service');
const { createCartRouter } = require('./modules/cart/cart.routes');

const { IdempotencyService } = require('./modules/orders/idempotency.service');
const { OrdersService } = require('./modules/orders/orders.service');
const { createOrdersRouter } = require('./modules/orders/orders.routes');

const { PaymentsService } = require('./modules/payments/payments.service');
const { createCheckoutRouter, createWebhookRouter } = require('./modules/payments/payments.routes');

const { AdminService } = require('./modules/admin/admin.service');
const { createAdminRouter } = require('./modules/admin/admin.routes');

const { KnowledgeRepository } = require('./modules/chat/knowledge.repository');
const { ChatService } = require('./modules/chat/chat.service');
const { createChatRouter } = require('./modules/chat/chat.routes');

function createHealthRouter({ checkReadiness }) {
  const router = express.Router();
  router.use(noStoreMiddleware);

  router.get('/live', (req, res) => {
    return res.status(200).json({ status: 'ok' });
  });
  router.all('/live', methodNotAllowed(['GET']));

  router.get('/ready', async (req, res, next) => {
    try {
      const ok = await checkReadiness();
      if (!ok) {
        return next(new AppError(503, 'SERVICE_UNAVAILABLE', 'Database readiness check failed.'));
      }
      return res.status(200).json({ status: 'ready' });
    } catch (_) {
      return next(new AppError(503, 'SERVICE_UNAVAILABLE', 'Database readiness check failed.'));
    }
  });
  router.all('/ready', methodNotAllowed(['GET']));

  return router;
}

function createApp(overrides = {}) {
  const prisma = overrides.prisma || getPrismaClient();
  const rateLimiter = overrides.rateLimiter || new SlidingWindowRateLimiter();
  const stripeClient = overrides.stripeClient || new StripeClient();
  const llmClient = overrides.llmClient || new LlmClient();
  const mailAdapter = overrides.mailAdapter || createMailAdapter(config.mail);

  const authRepository = overrides.authRepository || new AuthRepository(prisma);
  const passwordService = overrides.passwordService || new PasswordService(overrides.passwordServiceOptions);
  const authMailWorker =
    overrides.authMailWorker ||
    new AuthMailWorker({
      authRepository,
      mailAdapter,
      mailEncryption: config.mailEncryption,
      mailConfig: config.mail,
      appOrigin: config.appOrigin,
    });
  const authService =
    overrides.authService ||
    new AuthService(authRepository, {
      passwordService,
      rateLimiter,
      ...overrides.authServiceOptions,
    });
  const authMiddleware = createAuthMiddleware(authRepository);

  const categoriesRepository = overrides.categoriesRepository || new CategoriesRepository(prisma);
  const productsRepository = overrides.productsRepository || new ProductsRepository(prisma);
  const cartService = overrides.cartService || new CartService(prisma);
  const idempotencyService = overrides.idempotencyService || new IdempotencyService(prisma);
  const ordersService =
    overrides.ordersService ||
    new OrdersService(prisma, { idempotencyService, stripeClient });
  const paymentsService =
    overrides.paymentsService ||
    new PaymentsService(prisma, { idempotencyService, stripeClient, ordersService });
  if (!ordersService.onOrderAlreadyPaid && typeof paymentsService.settleOrderPaidFromStripeSession === 'function') {
    ordersService.onOrderAlreadyPaid = (orderId, remoteSession) =>
      paymentsService.settleOrderPaidFromStripeSession(orderId, remoteSession);
  }
  const adminService =
    overrides.adminService ||
    new AdminService(prisma, { productsRepository, ordersService });
  const knowledgeRepository = overrides.knowledgeRepository || new KnowledgeRepository(prisma);
  const chatService =
    overrides.chatService ||
    new ChatService({ knowledgeRepository, llmClient, productsRepository });

  const checkReadiness =
    overrides.checkReadiness ||
    (async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    });

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) {
    app.set('trust proxy', config.trustProxy);
  }

  // 1. Request context & security headers
  app.use(requestIdMiddleware);
  app.use(securityHeadersMiddleware);

  // 2. Strict CORS (exact allowlist, no wildcard)
  app.use(
    cors({
      origin(origin, callback) {
        // Allow non-browser requests (no Origin header) to pass CORS; mutations still require Origin in CSRF middleware
        if (!origin) return callback(null, false);
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'Location'],
    })
  );

  // 3. Reject duplicate query params globally
  app.use(rejectDuplicateQueryParams);

  // 4. Mount Stripe webhook route with raw body parser BEFORE JSON middleware
  app.use('/api/v1/webhooks', createWebhookRouter({ paymentsService }));

  // 5. Cookie parser & strict JSON body parser (16 KiB limit, duplicate/proto key rejection)
  app.use(cookieParser());
  app.use(strictJsonBodyMiddleware(16 * 1024));

  // 6. Operational Health routes (root and /api/v1)
  const healthRouter = createHealthRouter({ checkReadiness });
  app.use('/health', healthRouter);
  app.use('/api/v1/health', healthRouter);

  // 7. OpenAPI / Swagger documentation
  app.get('/api/v1/openapi.json', (req, res) => {
    res.status(200).json(openApiSpec);
  });
  app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  // 8. API v1 Business Routes
  app.use('/api/v1/auth', createAuthRouter({ authService, authMiddleware, rateLimiter }));
  app.use('/api/v1/categories', createCategoriesRouter({ categoriesRepository, rateLimiter }));
  app.use('/api/v1/products', createProductsRouter({ productsRepository, rateLimiter }));
  app.use('/api/v1/cart', createCartRouter({ cartService, authMiddleware, rateLimiter }));
  app.use('/api/v1/orders', createOrdersRouter({ ordersService, authMiddleware, rateLimiter }));
  app.use('/api/v1/checkout', createCheckoutRouter({ paymentsService, authMiddleware, rateLimiter }));
  app.use('/api/v1/admin', createAdminRouter({ adminService, authMiddleware, rateLimiter }));
  app.use('/api/v1/support', createChatRouter({ chatService, authMiddleware, rateLimiter }));

  // 9. 404 and centralized error normalization
  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,
    services: {
      authRepository,
      authService,
      passwordService,
      mailAdapter,
      authMailWorker,
      categoriesRepository,
      productsRepository,
      cartService,
      idempotencyService,
      ordersService,
      paymentsService,
      adminService,
      knowledgeRepository,
      chatService,
      stripeClient,
      llmClient,
      rateLimiter,
    },
  };
}

module.exports = { createApp };
