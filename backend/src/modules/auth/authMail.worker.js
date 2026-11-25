const { config } = require('../../config/env');
const { decryptEnvelope } = require('../../config/crypto');
const { renderAuthMail } = require('../../integrations/mail/mail.adapter');

function sanitizeMailErrorCode(err) {
  const raw = err?.code || err?.name || 'MAIL_DELIVERY_FAILED';
  return String(raw)
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, 100);
}

class AuthMailWorker {
  constructor({ authRepository, mailAdapter, mailEncryption, mailConfig, appOrigin } = {}) {
    this.authRepository = authRepository;
    this.mailAdapter = mailAdapter;
    this.mailEncryption = mailEncryption || config.mailEncryption;
    this.mailConfig = mailConfig || config.mail;
    this.appOrigin = appOrigin || config.appOrigin;
  }

  async processDueBatch({ limit = 20, now = new Date() } = {}) {
    const claimed = await this.authRepository.claimDueMailOutboxItems({
      limit,
      now,
      claimMs: 30_000,
    });

    const summary = { claimed: claimed.length, sent: 0, retried: 0, failed: 0, expired: 0 };

    for (const item of claimed) {
      let payload;
      try {
        if (!item.encryptedPayload) {
          throw Object.assign(new Error('Missing encrypted payload'), { code: 'PAYLOAD_MISSING' });
        }
        const plaintext = decryptEnvelope(
          item.encryptedPayload,
          {
            entity: 'AuthMailOutbox',
            rowId: item.id,
            field: 'encryptedPayload',
          },
          { masterKey: this.mailEncryption.masterKey }
        );
        payload = JSON.parse(plaintext);
      } catch (err) {
        const errorCode = sanitizeMailErrorCode(err);
        await this.authRepository.markMailOutboxFailed({
          id: item.id,
          errorCode,
          attempts: item.attempts + 1,
        });
        await this.authRepository
          .recordSecurityAuditEvent({
            eventType: 'AUTH_MAIL_FAILED',
            outcome: 'FAILURE',
            reasonCode: errorCode,
            metadata: { template: item.template, reason: 'decrypt_failed' },
          })
          .catch(() => {});
        summary.failed += 1;
        continue;
      }

      // Never send or retry an expired verification/reset link
      if (payload.expiresAt && new Date(payload.expiresAt) <= now) {
        await this.authRepository.markMailOutboxFailed({
          id: item.id,
          errorCode: 'TOKEN_EXPIRED',
          attempts: item.attempts + 1,
        });
        await this.authRepository
          .recordSecurityAuditEvent({
            eventType: 'AUTH_MAIL_FAILED',
            outcome: 'FAILURE',
            reasonCode: 'TOKEN_EXPIRED',
            metadata: { template: item.template },
          })
          .catch(() => {});
        summary.expired += 1;
        continue;
      }

      try {
        const rendered = renderAuthMail({
          template: item.template,
          payload,
          appOrigin: this.appOrigin,
        });
        await this.mailAdapter.sendMail({
          from: this.mailConfig.from,
          to: rendered.to,
          subject: rendered.subject,
          text: rendered.text,
          dedupeKey: item.dedupeKey,
          template: item.template,
        });
        await this.authRepository.markMailOutboxSent({
          id: item.id,
          sentAt: new Date(),
        });
        summary.sent += 1;
      } catch (err) {
        const nextAttempts = item.attempts + 1;
        const errorCode = sanitizeMailErrorCode(err);
        const backoffMs = Math.min(60_000, 1000 * 2 ** (nextAttempts - 1));
        const nextAttemptAt = new Date(now.getTime() + backoffMs);
        const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
        const exceededBudget =
          nextAttempts >= this.mailConfig.maxAttempts ||
          (expiresAt !== null && nextAttemptAt >= expiresAt);

        if (exceededBudget) {
          await this.authRepository.markMailOutboxFailed({
            id: item.id,
            errorCode,
            attempts: nextAttempts,
          });
          await this.authRepository
            .recordSecurityAuditEvent({
              eventType: 'AUTH_MAIL_FAILED',
              outcome: 'FAILURE',
              reasonCode: errorCode,
              metadata: { template: item.template, attempts: nextAttempts },
            })
            .catch(() => {});
          summary.failed += 1;
        } else {
          await this.authRepository.scheduleMailOutboxRetry({
            id: item.id,
            attempts: nextAttempts,
            nextAttemptAt,
            errorCode,
          });
          summary.retried += 1;
        }
      }
    }

    return summary;
  }

  async purgeExpiredRecords({ now = new Date() } = {}) {
    return this.authRepository.purgeAuthLifecycleRecords({ now });
  }
}

module.exports = {
  AuthMailWorker,
  sanitizeMailErrorCode,
};
