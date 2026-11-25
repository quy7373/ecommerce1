const { config } = require('./config/env');
const { getPrismaClient } = require('./config/prisma');
const { StripeClient } = require('./integrations/stripe/stripe.client');
const { createMailAdapter } = require('./integrations/mail/mail.adapter');
const { AuthRepository } = require('./modules/auth/auth.repository');
const { AuthMailWorker } = require('./modules/auth/authMail.worker');
const { IdempotencyService } = require('./modules/orders/idempotency.service');
const { OrdersService } = require('./modules/orders/orders.service');
const { PaymentsService } = require('./modules/payments/payments.service');

const prisma = getPrismaClient();
const stripeClient = new StripeClient();
const mailAdapter = createMailAdapter(config.mail);
const authRepository = new AuthRepository(prisma);
const authMailWorker = new AuthMailWorker({ authRepository, mailAdapter });
const idempotencyService = new IdempotencyService(prisma);
const ordersService = new OrdersService(prisma, { idempotencyService, stripeClient });
const paymentsService = new PaymentsService(prisma, {
  idempotencyService,
  stripeClient,
  ordersService,
});

let running = true;

async function tick() {
  if (!running) return;
  try {
    await paymentsService.reconcilePendingWork();
  } catch (err) {
    console.error('Worker reconciliation tick failed:', err.message);
  }
  try {
    await authMailWorker.processDueBatch();
    await authMailWorker.purgeExpiredRecords();
  } catch (err) {
    console.error('Worker auth mail tick failed:', err.message);
  }
  if (running) {
    setTimeout(tick, config.worker.pollIntervalMs);
  }
}

console.log(
  `Background worker started (payments + auth mail [${config.mail.transport}], poll: ${config.worker.pollIntervalMs}ms)`
);
tick();

async function shutdown(signal) {
  console.log(`Worker received ${signal}, stopping...`);
  running = false;
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
