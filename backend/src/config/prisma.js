const { PrismaClient } = require('@prisma/client');
const { AppError } = require('./errors');

let prismaInstance = null;

function getPrismaClient() {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return prismaInstance;
}

function setPrismaClient(client) {
  prismaInstance = client;
}

function isRetryableTxError(err) {
  if (!err) return false;
  if (err.code === 'P2034') return true;
  const pgCode = err.meta?.code || err.code;
  return pgCode === '40001' || pgCode === '40P01';
}

async function runSerializableTransaction(prisma, fn, options = {}) {
  const maxAttempts = options.maxAttempts || 3;
  const baseDelayMs = options.baseDelayMs || 50;

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: 'Serializable',
        maxWait: options.maxWait || 10_000,
        timeout: options.timeout || 20_000,
      });
    } catch (err) {
      lastError = err;
      if (!isRetryableTxError(err) || attempt === maxAttempts) {
        if (isRetryableTxError(err)) {
          throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Transaction contention; please retry shortly.');
        }
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw lastError;
}

module.exports = {
  getPrismaClient,
  setPrismaClient,
  runSerializableTransaction,
  isRetryableTxError,
};
