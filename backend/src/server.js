const http = require('http');
const { config } = require('./config/env');
const { getPrismaClient } = require('./config/prisma');
const { createApp } = require('./app');
const { createMailAdapter } = require('./integrations/mail/mail.adapter');
const { AuthMailWorker } = require('./modules/auth/authMail.worker');

const { app, services } = createApp();
const server = http.createServer(app);

// SEC-001 request/header timeout bounds
server.headersTimeout = 5_000;
server.requestTimeout = 30_000;

let mailWorkerTimer = null;
let mailTickRunning = false;

if (!config.isTest && process.env.AUTH_MAIL_INLINE_WORKER !== 'false') {
  const mailAdapter = createMailAdapter(config.mail);
  const authMailWorker = new AuthMailWorker({
    authRepository: services.authRepository,
    mailAdapter,
  });

  const runBackgroundTick = async () => {
    if (mailTickRunning) return;
    mailTickRunning = true;
    try {
      await authMailWorker.processDueBatch();
    } catch (err) {
      console.error('Inline auth mail worker tick failed:', err.message);
    }
    try {
      await services.paymentsService.reconcilePendingWork();
    } catch (err) {
      console.error('Inline payments reconciliation tick failed:', err.message);
    } finally {
      mailTickRunning = false;
    }
  };

  mailWorkerTimer = setInterval(runBackgroundTick, Math.min(config.worker.pollIntervalMs, 3000));
  if (typeof mailWorkerTimer.unref === 'function') {
    mailWorkerTimer.unref();
  }
  void runBackgroundTick();
}

server.listen(config.port, () => {
  console.log(
    `E-Commerce Backend API listening on port ${config.port} (${config.nodeEnv}, mail=${config.mail.transport})`
  );
});

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  if (mailWorkerTimer) {
    clearInterval(mailWorkerTimer);
    mailWorkerTimer = null;
  }
  server.close(async () => {
    try {
      await getPrismaClient().$disconnect();
    } catch (_) {
      // ignore
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
