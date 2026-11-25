const crypto = require('crypto');
const {
  sha256Hex,
  canonicalizeJson,
  encryptEnvelope,
  decryptEnvelope,
} = require('../../config/crypto');
const { AppError } = require('../../config/errors');

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const CLAIM_LEASE_MS = 30 * 1000;

class IdempotencyService {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async execute({ userId, method, route, key, body, handler }) {
    const requestHash = sha256Hex(canonicalizeJson(body));
    const now = new Date();
    const recordId = crypto.randomUUID();

    let existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_method_route_key: { userId, method, route, key },
      },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was already used with a different request payload.'
        );
      }
      if (existing.status === 'COMPLETED' && existing.responseBody) {
        const plaintext = decryptEnvelope(existing.responseBody, {
          entity: 'IdempotencyRecord',
          rowId: existing.id,
          field: 'responseBody',
        });
        return {
          status: existing.responseStatus,
          body: JSON.parse(plaintext),
          resourceId: existing.resourceId,
          replayed: true,
        };
      }
      if (existing.claimUntil && new Date(existing.claimUntil) > now) {
        throw new AppError(
          409,
          'REQUEST_IN_PROGRESS',
          'A request with this Idempotency-Key is currently in progress.',
          [],
          { 'Retry-After': '1' }
        );
      }

      // Atomically reclaim expired IN_PROGRESS lease so concurrent retries cannot double-execute
      const newLease = new Date(now.getTime() + CLAIM_LEASE_MS);
      const reclaimed = await this.prisma.idempotencyRecord.updateMany({
        where: {
          id: existing.id,
          status: 'IN_PROGRESS',
          OR: [{ claimUntil: null }, { claimUntil: { lte: now } }],
        },
        data: { claimUntil: newLease },
      });
      if (reclaimed.count !== 1) {
        throw new AppError(
          409,
          'REQUEST_IN_PROGRESS',
          'A request with this Idempotency-Key is currently in progress.',
          [],
          { 'Retry-After': '1' }
        );
      }
    } else {
      try {
        existing = await this.prisma.idempotencyRecord.create({
          data: {
            id: recordId,
            userId,
            method,
            route,
            key,
            requestHash,
            status: 'IN_PROGRESS',
            claimUntil: new Date(now.getTime() + CLAIM_LEASE_MS),
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          },
        });
      } catch (err) {
        if (err.code === 'P2002') {
          throw new AppError(
            409,
            'REQUEST_IN_PROGRESS',
            'A request with this Idempotency-Key is currently in progress.',
            [],
            { 'Retry-After': '1' }
          );
        }
        throw err;
      }
    }

    try {
      const result = await handler();
      const encryptedResponse = encryptEnvelope(result.body, {
        entity: 'IdempotencyRecord',
        rowId: existing.id,
        field: 'responseBody',
      });

      await this.prisma.idempotencyRecord.update({
        where: { id: existing.id },
        data: {
          status: 'COMPLETED',
          responseStatus: result.status,
          responseBody: encryptedResponse,
          resourceId: result.resourceId || null,
          claimUntil: null,
        },
      });

      return { ...result, replayed: false };
    } catch (err) {
      // Release transient claim on pre-side-effect errors so the same key can be retried safely
      await this.prisma.idempotencyRecord
        .delete({ where: { id: existing.id } })
        .catch(() => {});
      throw err;
    }
  }
}

module.exports = { IdempotencyService };
