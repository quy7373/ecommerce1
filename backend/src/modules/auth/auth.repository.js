const crypto = require('crypto');
const { config } = require('../../config/env');
const { hmacToPgBigIntKey } = require('../../config/crypto');

class AuthRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  _isInMemory() {
    return Boolean(this.prisma && this.prisma._db);
  }

  async _acquireEmailAdvisoryLock(tx, normalizedEmail) {
    if (this._isInMemory() || typeof tx.$executeRaw !== 'function') {
      return;
    }
    const lockKey = hmacToPgBigIntKey(normalizedEmail, config.auth.emailHmacSecret);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
  }

  async _lockActionTokenByHash(tx, tokenHash) {
    if (!this._isInMemory() && typeof tx.$queryRaw === 'function') {
      await tx.$queryRaw`SELECT "id" FROM "AuthActionToken" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
    }
    return tx.authActionToken.findUnique({ where: { tokenHash } });
  }

  async _lockPasswordCredentialByUserId(tx, userId) {
    if (!this._isInMemory() && typeof tx.$queryRaw === 'function') {
      await tx.$queryRaw`SELECT "userId" FROM "PasswordCredential" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
    }
    return tx.passwordCredential.findUnique({ where: { userId } });
  }

  async createOAuthAttempt(data) {
    return this.prisma.oAuthAttempt.create({
      data: {
        id: data.id || crypto.randomUUID(),
        stateHash: data.stateHash,
        browserBindingHash: data.browserBindingHash,
        nonceHash: data.nonceHash,
        encryptedCodeVerifier: data.encryptedCodeVerifier,
        expiresAt: data.expiresAt,
      },
    });
  }

  async consumeOAuthAttempt({ stateHash, now = new Date() }) {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.oAuthAttempt.findUnique({ where: { stateHash } });
      if (!attempt || attempt.consumedAt !== null || new Date(attempt.expiresAt) <= now) {
        return null;
      }
      const updated = await tx.oAuthAttempt.updateMany({
        where: { id: attempt.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (updated.count !== 1) return null;
      return attempt;
    });
  }

  async findUserByGoogleSubject(googleSubject) {
    return this.prisma.user.findUnique({ where: { googleSubject } });
  }

  async findUserByEmail(email) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findUserWithCredentialByEmail(email) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { credential: true },
    });
  }

  async createCustomerUser({ googleSubject = null, email, displayName, emailVerifiedAt = null }) {
    return this.prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        googleSubject,
        email,
        emailVerifiedAt,
        displayName,
        role: 'CUSTOMER',
      },
    });
  }

  async createVerifiedPasswordUser({ email, displayName, passwordHash, requestId, now = new Date() }) {
    return this.prisma.$transaction(async (tx) => {
      await this._acquireEmailAdvisoryLock(tx, email);
      const userId = crypto.randomUUID();
      const user = await tx.user.create({
        data: {
          id: userId,
          googleSubject: null,
          email,
          emailVerifiedAt: now,
          displayName,
          role: 'CUSTOMER',
        },
      });
      await tx.passwordCredential.create({
        data: {
          userId: user.id,
          passwordHash,
          version: 1,
          passwordChangedAt: now,
        },
      });
      await tx.securityAuditOutbox
        .create({
          data: {
            id: crypto.randomUUID(),
            eventType: 'AUTH_REGISTER_COMPLETED',
            requestId: requestId || null,
            actorId: user.id,
            outcome: 'SUCCESS',
            metadata: { provider: 'password_direct' },
          },
        })
        .catch(() => {});
      return user;
    });
  }

  async markUserEmailVerified(userId, verifiedAt = new Date()) {
    return this.prisma.user.updateMany({
      where: { id: userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: verifiedAt },
    });
  }

  async createSession({ userId, csrfTokenHash, expiresAt }, tx = this.prisma) {
    return tx.authSession.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        csrfTokenHash,
        expiresAt,
      },
    });
  }

  async findActiveSessionWithUser(sessionId) {
    return this.prisma.authSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
  }

  async rotateCsrfTokenHash(sessionId, newCsrfTokenHash) {
    return this.prisma.authSession.update({
      where: { id: sessionId },
      data: { csrfTokenHash: newCsrfTokenHash },
    });
  }

  async revokeSession(sessionId, revokedAt = new Date(), tx = this.prisma) {
    return tx.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt },
    });
  }

  async revokeAllUserSessions(userId, revokedAt = new Date(), tx = this.prisma) {
    return tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
  }

  async recordSecurityAuditEvent(event, tx = this.prisma) {
    if (!tx.securityAuditOutbox) return null;
    return tx.securityAuditOutbox.create({
      data: {
        id: crypto.randomUUID(),
        eventType: event.eventType,
        requestId: event.requestId || null,
        actorId: event.actorId || null,
        resourceType: event.resourceType || null,
        resourceId: event.resourceId || null,
        outcome: event.outcome,
        reasonCode: event.reasonCode || null,
        metadata: event.metadata || {},
      },
    });
  }

  async findActionTokenByHash(tokenHash) {
    return this.prisma.authActionToken.findUnique({ where: { tokenHash } });
  }

  async runInTransaction(fn) {
    return this.prisma.$transaction((tx) => fn(tx));
  }

  async createRegistrationTokenAndMail({
    email,
    tokenId,
    tokenHash,
    expiresAt,
    maxActiveTokens,
    outboxId,
    dedupeKey,
    encryptedPayload,
    requestId,
    now = new Date(),
  }) {
    return this.prisma.$transaction(async (tx) => {
      await this._acquireEmailAdvisoryLock(tx, email);

      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser) {
        return { enqueued: false, reason: 'USER_EXISTS' };
      }

      const activeTokens = await tx.authActionToken.count({
        where: {
          purpose: 'VERIFY_EMAIL',
          email,
          consumedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (activeTokens >= maxActiveTokens) {
        return { enqueued: false, reason: 'MAX_ACTIVE_TOKENS' };
      }

      await tx.authActionToken.create({
        data: {
          id: tokenId,
          purpose: 'VERIFY_EMAIL',
          tokenHash,
          email,
          userId: null,
          credentialVersion: null,
          expiresAt,
        },
      });

      await tx.authMailOutbox.create({
        data: {
          id: outboxId,
          dedupeKey,
          template: 'VERIFY_EMAIL',
          encryptedPayload,
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: now,
        },
      });

      await this.recordSecurityAuditEvent(
        {
          eventType: 'AUTH_REGISTER_REQUESTED',
          requestId,
          outcome: 'SUCCESS',
          metadata: { purpose: 'VERIFY_EMAIL' },
        },
        tx
      );

      return { enqueued: true, tokenId, outboxId };
    });
  }

  async completeEmailVerificationTransaction({
    tokenHash,
    displayName,
    passwordHash,
    requestId,
    now = new Date(),
  }) {
    return this.prisma.$transaction(async (tx) => {
      const token = await this._lockActionTokenByHash(tx, tokenHash);
      if (
        !token ||
        token.purpose !== 'VERIFY_EMAIL' ||
        token.consumedAt !== null ||
        new Date(token.expiresAt) <= now
      ) {
        return { ok: false, reason: 'TOKEN_INVALID' };
      }

      await this._acquireEmailAdvisoryLock(tx, token.email);

      const existingUser = await tx.user.findUnique({ where: { email: token.email } });
      if (existingUser) {
        return { ok: false, reason: 'EMAIL_TAKEN' };
      }

      const consumed = await tx.authActionToken.updateMany({
        where: { id: token.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        return { ok: false, reason: 'TOKEN_ALREADY_CONSUMED' };
      }

      const userId = crypto.randomUUID();
      const user = await tx.user.create({
        data: {
          id: userId,
          googleSubject: null,
          email: token.email,
          emailVerifiedAt: now,
          displayName,
          role: 'CUSTOMER',
        },
      });

      await tx.passwordCredential.create({
        data: {
          userId: user.id,
          passwordHash,
          version: 1,
          passwordChangedAt: now,
        },
      });

      await this.recordSecurityAuditEvent(
        {
          eventType: 'EMAIL_VERIFIED',
          requestId,
          actorId: user.id,
          outcome: 'SUCCESS',
          metadata: { method: 'email_password' },
        },
        tx
      );

      return { ok: true, user };
    });
  }

  async finalizePasswordLoginTransaction({
    userId,
    expectedVersion,
    expectedHash,
    rehashedPasswordHash = null,
    existingSessionId = null,
    csrfTokenHash,
    sessionExpiresAt,
    requestId,
    now = new Date(),
  }) {
    return this.prisma.$transaction(async (tx) => {
      const credential = await this._lockPasswordCredentialByUserId(tx, userId);
      if (
        !credential ||
        credential.version !== expectedVersion ||
        credential.passwordHash !== expectedHash
      ) {
        return { ok: false, reason: 'CREDENTIAL_CHANGED' };
      }

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || !user.emailVerifiedAt) {
        return { ok: false, reason: 'USER_UNAVAILABLE' };
      }

      if (rehashedPasswordHash) {
        await tx.passwordCredential.updateMany({
          where: { userId, version: expectedVersion },
          data: { passwordHash: rehashedPasswordHash },
        });
      }

      if (existingSessionId) {
        await this.revokeSession(existingSessionId, now, tx);
      }

      const session = await this.createSession(
        {
          userId: user.id,
          csrfTokenHash,
          expiresAt: sessionExpiresAt,
        },
        tx
      );

      await this.recordSecurityAuditEvent(
        {
          eventType: 'AUTH_LOGIN_SUCCEEDED',
          requestId,
          actorId: user.id,
          outcome: 'SUCCESS',
          metadata: { provider: 'password' },
        },
        tx
      );

      return { ok: true, user, session };
    });
  }

  async createPasswordResetTokenAndMail({
    email,
    tokenId,
    tokenHash,
    expiresAt,
    maxActiveTokens,
    outboxId,
    dedupeKey,
    encryptedPayload,
    requestId,
    now = new Date(),
  }) {
    return this.prisma.$transaction(async (tx) => {
      await this._acquireEmailAdvisoryLock(tx, email);

      const user = await tx.user.findUnique({
        where: { email },
        include: { credential: true },
      });
      if (!user || !user.credential || !user.emailVerifiedAt) {
        return { enqueued: false, reason: 'NOT_ELIGIBLE' };
      }

      const activeTokens = await tx.authActionToken.count({
        where: {
          purpose: 'RESET_PASSWORD',
          userId: user.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (activeTokens >= maxActiveTokens) {
        return { enqueued: false, reason: 'MAX_ACTIVE_TOKENS' };
      }

      await tx.authActionToken.create({
        data: {
          id: tokenId,
          purpose: 'RESET_PASSWORD',
          tokenHash,
          email: user.email,
          userId: user.id,
          credentialVersion: user.credential.version,
          expiresAt,
        },
      });

      await tx.authMailOutbox.create({
        data: {
          id: outboxId,
          dedupeKey,
          template: 'RESET_PASSWORD',
          encryptedPayload,
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: now,
        },
      });

      await this.recordSecurityAuditEvent(
        {
          eventType: 'PASSWORD_RESET_REQUESTED',
          requestId,
          actorId: user.id,
          outcome: 'SUCCESS',
          metadata: { purpose: 'RESET_PASSWORD' },
        },
        tx
      );

      return { enqueued: true, userId: user.id, tokenId, outboxId };
    });
  }

  async completePasswordResetTransaction({
    tokenHash,
    newPasswordHash,
    buildNotificationOutbox,
    requestId,
    now = new Date(),
  }) {
    return this.prisma.$transaction(async (tx) => {
      const token = await this._lockActionTokenByHash(tx, tokenHash);
      if (
        !token ||
        token.purpose !== 'RESET_PASSWORD' ||
        token.consumedAt !== null ||
        new Date(token.expiresAt) <= now ||
        !token.userId ||
        token.credentialVersion === null
      ) {
        return { ok: false, reason: 'TOKEN_INVALID' };
      }

      const credential = await this._lockPasswordCredentialByUserId(tx, token.userId);
      if (!credential || credential.version !== token.credentialVersion) {
        return { ok: false, reason: 'CREDENTIAL_VERSION_MISMATCH' };
      }

      const user = await tx.user.findUnique({ where: { id: token.userId } });
      if (!user || user.email !== token.email) {
        return { ok: false, reason: 'USER_MISMATCH' };
      }

      const consumed = await tx.authActionToken.updateMany({
        where: { id: token.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        return { ok: false, reason: 'TOKEN_ALREADY_CONSUMED' };
      }

      // Invalidate all other unconsumed reset tokens for this user
      await tx.authActionToken.updateMany({
        where: {
          userId: user.id,
          purpose: 'RESET_PASSWORD',
          consumedAt: null,
        },
        data: { consumedAt: now },
      });

      const nextVersion = credential.version + 1;
      const updatedCred = await tx.passwordCredential.updateMany({
        where: { userId: user.id, version: credential.version },
        data: {
          passwordHash: newPasswordHash,
          version: nextVersion,
          passwordChangedAt: now,
        },
      });
      if (updatedCred.count !== 1) {
        return { ok: false, reason: 'CREDENTIAL_CONFLICT' };
      }

      // Revoke ALL active sessions for this user
      await this.revokeAllUserSessions(user.id, now, tx);

      // Enqueue PASSWORD_CHANGED notification (no password or reset token)
      const notification = buildNotificationOutbox({
        userId: user.id,
        email: user.email,
        newVersion: nextVersion,
      });
      await tx.authMailOutbox.create({
        data: {
          id: notification.outboxId,
          dedupeKey: notification.dedupeKey,
          template: 'PASSWORD_CHANGED',
          encryptedPayload: notification.encryptedPayload,
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: now,
        },
      });

      await this.recordSecurityAuditEvent(
        {
          eventType: 'PASSWORD_RESET_SUCCEEDED',
          requestId,
          actorId: user.id,
          outcome: 'SUCCESS',
          metadata: { credentialVersion: nextVersion },
        },
        tx
      );

      return { ok: true, userId: user.id, newVersion: nextVersion };
    });
  }

  async claimDueMailOutboxItems({ limit = 20, now = new Date(), claimMs = 30_000 } = {}) {
    const claimUntil = new Date(now.getTime() + claimMs);
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.authMailOutbox.findMany({
        where: {
          OR: [
            { status: 'PENDING', nextAttemptAt: { lte: now } },
            { status: 'SENDING', claimUntil: { lte: now } },
          ],
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        take: limit,
      });

      const claimed = [];
      for (const item of candidates) {
        const res = await tx.authMailOutbox.updateMany({
          where: {
            id: item.id,
            status: item.status,
          },
          data: {
            status: 'SENDING',
            claimUntil,
          },
        });
        if (res.count === 1) {
          claimed.push({ ...item, status: 'SENDING', claimUntil });
        }
      }
      return claimed;
    });
  }

  async markMailOutboxSent({ id, sentAt = new Date() }) {
    return this.prisma.authMailOutbox.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt,
        encryptedPayload: null,
        claimUntil: null,
        lastErrorCode: null,
      },
    });
  }

  async scheduleMailOutboxRetry({ id, attempts, nextAttemptAt, errorCode }) {
    return this.prisma.authMailOutbox.update({
      where: { id },
      data: {
        status: 'PENDING',
        attempts,
        nextAttemptAt,
        claimUntil: null,
        lastErrorCode: errorCode,
      },
    });
  }

  async markMailOutboxFailed({ id, errorCode, attempts }) {
    return this.prisma.authMailOutbox.update({
      where: { id },
      data: {
        status: 'FAILED',
        attempts,
        encryptedPayload: null,
        claimUntil: null,
        lastErrorCode: errorCode,
      },
    });
  }

  async purgeAuthLifecycleRecords({ now = new Date() } = {}) {
    const tokenCutoff = new Date(now.getTime() - 60 * 60 * 1000); // 1h after consumed/expiry
    const outboxPayloadCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h max payload retention
    const outboxMetadataCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7d metadata retention

    const deletedTokens = await this.prisma.authActionToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: tokenCutoff } },
          { consumedAt: { lte: tokenCutoff } },
        ],
      },
    });

    const purgedPayloads = await this.prisma.authMailOutbox.updateMany({
      where: {
        createdAt: { lte: outboxPayloadCutoff },
        encryptedPayload: { not: null },
      },
      data: { encryptedPayload: null },
    });

    const deletedOutbox = await this.prisma.authMailOutbox.deleteMany({
      where: {
        createdAt: { lte: outboxMetadataCutoff },
        status: { in: ['SENT', 'FAILED'] },
      },
    });

    return {
      deletedTokens: deletedTokens.count,
      purgedPayloads: purgedPayloads.count,
      deletedOutbox: deletedOutbox.count,
    };
  }
}

module.exports = { AuthRepository };
