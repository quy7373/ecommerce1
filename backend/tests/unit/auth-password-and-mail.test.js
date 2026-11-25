process.env.NODE_ENV = 'test';

const {
  PasswordService,
  MIN_MEMORY_KIB,
  MIN_TIME_COST,
  MIN_PARALLELISM,
} = require('../../src/modules/auth/password.service');
const {
  emailSchema,
  displayNameSchema,
  actionTokenSchema,
  loginPasswordSchema,
  assertNewPasswordAllowed,
  redactEmailForLog,
} = require('../../src/modules/auth/auth.validator');
const { BLOCKLIST_VERSION, isCommonOrBreachedPassword } = require('../../src/modules/auth/common-passwords');
const { buildAuthActionUrl, renderAuthMail } = require('../../src/integrations/mail/mail.adapter');
const { sha256Hex, randomBase64Url, encryptEnvelope, decryptEnvelope } = require('../../src/config/crypto');
const { config } = require('../../src/config/env');

describe('Unit: AUTH-002 Password Policy, Argon2id, Tokens & Mail Links', () => {
  describe('Email, DisplayName, ActionToken & Password Validators', () => {
    it('normalizes email by trim+lowercase without stripping dots or +tags', () => {
      expect(emailSchema.parse('  Alice.Smith+promo@Example.COM  ')).toBe('alice.smith+promo@example.com');
    });

    it('rejects non-ASCII, display-name, or malformed emails', () => {
      expect(() => emailSchema.parse('Alice <alice@example.com>')).toThrow();
      expect(() => emailSchema.parse('üser@example.com')).toThrow();
      expect(() => emailSchema.parse('not-an-email')).toThrow();
      expect(() => emailSchema.parse('a@b')).toThrow();
    });

    it('normalizes displayName to NFC and counts code points 1..100', () => {
      const nfd = 'Cafe\u0301'; // 5 UTF-16 units, 4 NFC code points
      expect(displayNameSchema.parse(`  ${nfd}  `)).toBe('Café');
      expect(() => displayNameSchema.parse('   ')).toThrow();
      expect(() => displayNameSchema.parse('😀'.repeat(101))).toThrow();
      expect(displayNameSchema.parse('😀'.repeat(100))).toBe('😀'.repeat(100));
    });

    it('validates 43-char base64url action tokens without trimming', () => {
      const token = randomBase64Url(32);
      expect(token).toHaveLength(43);
      expect(actionTokenSchema.parse(token)).toBe(token);
      expect(() => actionTokenSchema.parse(` ${token} `)).toThrow();
      expect(() => actionTokenSchema.parse('short')).toThrow();
      expect(() => actionTokenSchema.parse(`${token.slice(0, 42)}=`)).toThrow();
    });

    it('preserves whitespace and Unicode in passwords (no trim/truncation) and enforces NFC 8..128 cp, complexity, and <=512 bytes', () => {
      const withSpaces = '  My Unique Passphrase 2026!  ';
      expect(() => assertNewPasswordAllowed(withSpaces)).not.toThrow();

      // 8 code points with uppercase, lowercase, digit, special char -> allowed
      expect(() => assertNewPasswordAllowed('Kanto#26')).not.toThrow();

      // Missing complexity rules rejected with 400 PASSWORD_NOT_ALLOWED
      expect(() => assertNewPasswordAllowed('kanto#26')).toThrow(/security requirements/i); // missing uppercase
      expect(() => assertNewPasswordAllowed('KANTO#26')).toThrow(/security requirements/i); // missing lowercase
      expect(() => assertNewPasswordAllowed('Kanto!@#')).toThrow(/security requirements/i); // missing digit
      expect(() => assertNewPasswordAllowed('Kanto2026')).toThrow(/security requirements/i); // missing special char

      // 7 code points rejected with PASSWORD_NOT_ALLOWED and field=password
      try {
        assertNewPasswordAllowed('Ka#2026');
        throw new Error('Expected failure');
      } catch (err) {
        expect(err.status).toBe(400);
        expect(err.code).toBe('PASSWORD_NOT_ALLOWED');
        expect(err.details[0].field).toBe('password');
      }

      // 128 code points with Unicode & complexity -> allowed (<= 512 bytes)
      const max128Unicode = 'Aa1!' + '🔐🔑'.repeat(62);
      expect(Array.from(max128Unicode).length).toBe(128);
      expect(Buffer.byteLength(max128Unicode, 'utf8')).toBeLessThanOrEqual(512);
      expect(() => assertNewPasswordAllowed(max128Unicode)).not.toThrow();

      // 129 code points rejected
      expect(() => assertNewPasswordAllowed('a'.repeat(129))).toThrow(/security requirements/i);

      // Blocklisted common password rejected
      expect(BLOCKLIST_VERSION).toBeTruthy();
      expect(isCommonOrBreachedPassword('Password12345678')).toBe(true);
      expect(isCommonOrBreachedPassword('aaaaaaaaaaaaaaaa')).toBe(true);
      expect(() => assertNewPasswordAllowed('CorrectHorseBatteryStaple')).toThrow(/security requirements/i);

      // Login password does NOT enforce min-15 or blocklist
      expect(loginPasswordSchema.parse('short')).toBe('short');
      expect(loginPasswordSchema.parse('  keep spaces  ')).toBe('  keep spaces  ');
      expect(loginPasswordSchema.parse('Password12345678')).toBe('Password12345678');
    });

    it('redacts email local-part for safe logging', () => {
      expect(redactEmailForLog('alice@example.com')).toBe('[REDACTED]@example.com');
      expect(redactEmailForLog('not-email')).toBe('[REDACTED]');
    });
  });

  describe('Argon2id PasswordService', () => {
    it('hashes with Argon2id minimum params, unique salts, verifies NFC/spaces, and detects rehash', async () => {
      const svc = new PasswordService({
        argon2: { memoryCost: 1024, timeCost: 1, parallelism: 1 }, // below minimum -> clamped up
        maxConcurrency: 4,
      });

      expect(svc.argonOptions.memoryCost).toBe(MIN_MEMORY_KIB);
      expect(svc.argonOptions.timeCost).toBe(MIN_TIME_COST);
      expect(svc.argonOptions.parallelism).toBe(MIN_PARALLELISM);

      const pw = '  passphrase Café with spaces!  ';
      const h1 = await svc.hashPassword(pw.normalize('NFC'));
      const h2 = await svc.hashPassword(pw.normalize('NFC'));

      expect(h1.startsWith('$argon2id$')).toBe(true);
      expect(h1).toContain(`m=${MIN_MEMORY_KIB},t=${MIN_TIME_COST},p=${MIN_PARALLELISM}`);
      expect(h1).not.toBe(h2); // unique random salt

      expect(await svc.verifyPassword(h1, pw.normalize('NFC'))).toBe(true);
      expect(await svc.verifyPassword(h1, pw.trim().normalize('NFC'))).toBe(false); // whitespace preserved

      const upgradedSvc = new PasswordService({
        argon2: { memoryCost: MIN_MEMORY_KIB * 2, timeCost: 2, parallelism: 1 },
      });
      expect(upgradedSvc.needsRehash(h1)).toBe(true);
      expect(svc.needsRehash(h1)).toBe(false);
    });

    it('rejects with 503 when hash concurrency budget is saturated', async () => {
      const svc = new PasswordService({ maxConcurrency: 1 });
      svc.inFlight = 1;
      await expect(svc.hashPassword('unique-passphrase-123456')).rejects.toMatchObject({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
      });
    });
  });

  describe('Fixed Fragment Action URLs & Mail Encryption Isolation', () => {
    it('builds fixed frontend fragment URLs and rejects invalid origins or tokens', () => {
      const token = randomBase64Url(32);
      expect(sha256Hex(token)).toHaveLength(64);

      expect(buildAuthActionUrl('VERIFY_EMAIL', token, 'https://shop.example.com/')).toBe(
        `https://shop.example.com/verify-email#token=${token}`
      );
      expect(buildAuthActionUrl('RESET_PASSWORD', token, 'http://localhost:5173')).toBe(
        `http://localhost:5173/reset-password#token=${token}`
      );
      expect(() => buildAuthActionUrl('VERIFY_EMAIL', 'bad-token', 'https://shop.example.com')).toThrow();
      expect(() => buildAuthActionUrl('VERIFY_EMAIL', token, 'javascript:alert(1)')).toThrow();
    });

    it('renders PASSWORD_CHANGED notification without any password or token', () => {
      const rendered = renderAuthMail({
        template: 'PASSWORD_CHANGED',
        payload: { to: 'alice@example.com' },
      });
      expect(rendered.to).toBe('alice@example.com');
      expect(rendered.text).not.toContain('#token=');
      expect(rendered.actionUrl).toBeNull();
    });

    it('keeps mail encryption key isolated from main application encryption key', () => {
      const aad = { entity: 'AuthMailOutbox', rowId: 'row-1', field: 'encryptedPayload' };
      const env = encryptEnvelope(
        { to: 'alice@example.com', token: randomBase64Url(32) },
        aad,
        { keyId: config.mailEncryption.keyId, masterKey: config.mailEncryption.masterKey }
      );
      // Main app key cannot decrypt mail payload
      expect(() => decryptEnvelope(env, aad, { masterKey: config.encryption.masterKey })).toThrow();
      // Mail key decrypts cleanly
      const decrypted = JSON.parse(
        decryptEnvelope(env, aad, { masterKey: config.mailEncryption.masterKey })
      );
      expect(decrypted.to).toBe('alice@example.com');
    });
  });
});
