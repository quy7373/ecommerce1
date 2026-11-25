// Separate mail outbox worker process using dedicated mail encryption identity.
// Does NOT access Stripe secrets or Order shipping addresses.
const { config } = require('./config/env');
const { getPrismaClient } = require('./config/prisma');
const { createMailAdapter } = require('./integrations/mail/mail.adapter');
const { AuthRepository } = require('./modules/auth/auth.repository');
const { AuthMailWorker } = require('./modules/auth/authMail.worker');

const prisma = getPrismaClient();
const authRepository = new AuthRepository(prisma);
const mailAdapter = createMailAdapter(config.mail);
const mailWorker = new AuthMailWorker({
  authRepository,
  mailAdapter,
  mailEncryption: config.mailEncryption,
  mailConfig: config.mail,
  appOrigin: config.appOrigin,
});

let running = true;

async function tick() {
  if (!running) return;
  try {
    await mailWorker.processDueBatch();
    await mailWorker.purgeExpiredRecords();
  } catch (err) {
    console.error('Auth mail worker tick failed:', err.message);
  }
  if (running) {
    setTimeout(tick, config.worker.pollIntervalMs);
  }
}

console.log(`Auth mail worker started (transport: ${config.mail.transport}, poll: ${config.worker.pollIntervalMs}ms)`);
tick();

async function shutdown(signal) {
  console.log(`Auth mail worker received ${signal}, stopping...`);
  running = false;
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
