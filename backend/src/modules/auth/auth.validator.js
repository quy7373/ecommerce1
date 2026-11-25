const { z } = require('zod');
const { AppError } = require('../../config/errors');
const { codePointLength } = require('../../middleware/validate');
const { isCommonOrBreachedPassword } = require('./common-passwords');

// Strict ASCII single-address email regex (no display-name, no comments, no SMTPUTF8)
const ASCII_ONLY_REGEX = /^[\x20-\x7E]+$/;
const STRICT_ASCII_EMAIL_REGEX =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// ActionToken: base64url without padding of 32 random bytes = exactly 43 chars
const ACTION_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

function normalizeEmail(raw) {
  return raw.trim().toLowerCase();
}

function isValidEmail(normalized) {
  if (typeof normalized !== 'string') return false;
  if (normalized.length < 3 || normalized.length > 254) return false;
  if (!ASCII_ONLY_REGEX.test(normalized)) return false;
  if (/\s/.test(normalized)) return false;
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0 || atIndex > 64) return false;
  if (normalized.indexOf('@', atIndex + 1) !== -1) return false;
  return STRICT_ASCII_EMAIL_REGEX.test(normalized);
}

const emailSchema = z
  .string()
  .transform((v) => normalizeEmail(v))
  .refine((v) => isValidEmail(v), {
    message: 'Must be a valid ASCII email address (3..254 characters).',
  });

const displayNameSchema = z
  .string()
  .transform((v) => v.trim().normalize('NFC'))
  .refine((v) => {
    const len = codePointLength(v);
    return len >= 1 && len <= 100;
  }, {
    message: 'Display name must be between 1 and 100 characters.',
  });

// ActionToken must NEVER go through normalizeText/trim
const actionTokenSchema = z
  .string()
  .refine((v) => ACTION_TOKEN_REGEX.test(v), {
    message: 'Token must be a valid 43-character base64url string.',
  });

// Password on login: do NOT trim, do NOT enforce min-15 or blocklist.
// Only check non-empty string, NFC, <= 128 code points and <= 512 UTF-8 bytes.
const loginPasswordSchema = z
  .string()
  .min(1, 'Password is required.')
  .transform((v) => v.normalize('NFC'))
  .refine((v) => codePointLength(v) <= 128 && Buffer.byteLength(v, 'utf8') <= 512, {
    message: 'Password exceeds maximum allowed length.',
  });

// Password on verify-email / reset-password:
// Zod checks type and non-empty; policy validation runs explicitly to return 400 PASSWORD_NOT_ALLOWED.
const rawNewPasswordSchema = z
  .string()
  .min(1, 'Password is required.')
  .transform((v) => v.normalize('NFC'));

const HAS_UPPERCASE_REGEX = /[A-Z]/;
const HAS_LOWERCASE_REGEX = /[a-z]/;
const HAS_DIGIT_REGEX = /[0-9]/;
const HAS_SPECIAL_REGEX = /[^A-Za-z0-9\s]/;

function assertNewPasswordAllowed(nfcPassword) {
  const cpLen = codePointLength(nfcPassword);
  const byteLen = Buffer.byteLength(nfcPassword, 'utf8');
  const violations = [];

  if (cpLen < 8 || cpLen > 128) {
    violations.push({
      field: 'password',
      code: 'RANGE',
      message: 'Password must be between 8 and 128 characters.',
    });
  }

  if (byteLen > 512) {
    violations.push({
      field: 'password',
      code: 'RANGE',
      message: 'Password must not exceed 512 UTF-8 bytes.',
    });
  }

  if (!HAS_UPPERCASE_REGEX.test(nfcPassword)) {
    violations.push({
      field: 'password',
      code: 'COMPLEXITY',
      message: 'Password must include at least one uppercase letter (A-Z).',
    });
  }

  if (!HAS_LOWERCASE_REGEX.test(nfcPassword)) {
    violations.push({
      field: 'password',
      code: 'COMPLEXITY',
      message: 'Password must include at least one lowercase letter (a-z).',
    });
  }

  if (!HAS_DIGIT_REGEX.test(nfcPassword)) {
    violations.push({
      field: 'password',
      code: 'COMPLEXITY',
      message: 'Password must include at least one number (0-9).',
    });
  }

  if (!HAS_SPECIAL_REGEX.test(nfcPassword)) {
    violations.push({
      field: 'password',
      code: 'COMPLEXITY',
      message: 'Password must include at least one special character (e.g., !@#$%^&*).',
    });
  }

  if (violations.length > 0) {
    throw new AppError(
      400,
      'PASSWORD_NOT_ALLOWED',
      'Password does not meet security requirements.',
      violations
    );
  }

  if (isCommonOrBreachedPassword(nfcPassword)) {
    throw new AppError(
      400,
      'PASSWORD_NOT_ALLOWED',
      'Password does not meet security requirements.',
      [
        {
          field: 'password',
          code: 'PASSWORD_BLOCKED',
          message: 'This password is too common or has appeared in known breaches. Choose another password.',
        },
      ]
    );
  }
}

const registerBodySchema = z
  .object({
    email: emailSchema,
    displayName: displayNameSchema.optional(),
    password: rawNewPasswordSchema.optional(),
  })
  .strict()
  .refine((data) => (data.displayName === undefined) === (data.password === undefined), {
    message: 'Both displayName and password are required for direct registration.',
    path: ['password'],
  });

const verifyEmailBodySchema = z
  .object({
    token: actionTokenSchema,
    displayName: displayNameSchema,
    password: rawNewPasswordSchema,
  })
  .strict();

const loginBodySchema = z
  .object({
    email: emailSchema,
    password: loginPasswordSchema,
  })
  .strict();

const forgotPasswordBodySchema = z
  .object({
    email: emailSchema,
  })
  .strict();

const resetPasswordBodySchema = z
  .object({
    token: actionTokenSchema,
    password: rawNewPasswordSchema,
  })
  .strict();

function redactEmailForLog(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '[REDACTED]';
  const [, domain] = email.split('@');
  return `[REDACTED]@${domain || 'unknown'}`;
}

module.exports = {
  ACTION_TOKEN_REGEX,
  normalizeEmail,
  isValidEmail,
  emailSchema,
  displayNameSchema,
  actionTokenSchema,
  loginPasswordSchema,
  rawNewPasswordSchema,
  assertNewPasswordAllowed,
  registerBodySchema,
  verifyEmailBodySchema,
  loginBodySchema,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  redactEmailForLog,
};
