const { z } = require('zod');
const { AppError, validationError, mapZodError } = require('../config/errors');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
const US_POSTAL_REGEX = /^[0-9]{5}(-[0-9]{4})?$/;
const E164_PHONE_REGEX = /^\+[1-9][0-9]{7,14}$/;
const SKU_REGEX = /^[A-Z0-9_-]{1,64}$/;
const BASE10_INT_REGEX = /^[0-9]+$/;

function normalizeText(value) {
  if (typeof value !== 'string') return value;
  return value.trim().normalize('NFC');
}

function codePointLength(str) {
  return Array.from(str).length;
}

function nfcString(min, max, label = 'Value') {
  return z
    .string()
    .transform((v) => normalizeText(v))
    .refine((v) => codePointLength(v) >= min && codePointLength(v) <= max, {
      message: `${label} must be between ${min} and ${max} characters.`,
    });
}

const uuidSchema = z
  .string()
  .refine((v) => UUID_REGEX.test(v), { message: 'Must be a valid UUID.' });

const moneySchema = z
  .number()
  .int()
  .min(0)
  .max(100_000_000);

const positivePriceSchema = z
  .number()
  .int()
  .min(1)
  .max(100_000_000);

const qtySchema = z
  .number()
  .int()
  .min(1)
  .max(99);

const versionSchema = z
  .number()
  .int()
  .min(1)
  .max(2_147_483_647);

const addressSchema = z
  .object({
    fullName: nfcString(1, 100, 'Full name'),
    line1: nfcString(1, 200, 'Address line 1'),
    line2: nfcString(1, 200, 'Address line 2').optional(),
    city: nfcString(1, 100, 'City'),
    region: nfcString(1, 100, 'Region'),
    postalCode: z
      .string()
      .transform(normalizeText)
      .refine((v) => US_POSTAL_REGEX.test(v), {
        message: 'Use a five-digit US postal code or ZIP+4.',
      }),
    country: z.literal('US'),
    phone: z
      .string()
      .transform(normalizeText)
      .refine((v) => E164_PHONE_REGEX.test(v), {
        message: 'Phone must be in E.164 format (+1234567890).',
      })
      .optional(),
  })
  .strict();

function validateUuidParam(paramName) {
  return (req, res, next) => {
    const val = req.params[paramName];
    if (!val || !UUID_REGEX.test(val)) {
      return next(
        validationError([
          { field: `params.${paramName}`, code: 'FORMAT', message: `${paramName} must be a valid UUID.` },
        ])
      );
    }
    return next();
  };
}

function validateIdempotencyKeyHeader(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key || typeof key !== 'string') {
    return next(
      validationError([
        {
          field: 'headers.Idempotency-Key',
          code: 'REQUIRED',
          message: 'Idempotency-Key header is required.',
        },
      ])
    );
  }
  if (!IDEMPOTENCY_KEY_REGEX.test(key)) {
    return next(
      validationError([
        {
          field: 'headers.Idempotency-Key',
          code: 'FORMAT',
          message: 'Idempotency-Key must be 16..128 ASCII [A-Za-z0-9_-] characters.',
        },
      ])
    );
  }
  req.idempotencyKey = key;
  return next();
}

function requireEmptyQuery(req, res, next) {
  const keys = Object.keys(req.query || {});
  if (keys.length > 0) {
    return next(
      validationError(
        keys.map((k) => ({
          field: `query.${k}`,
          code: 'UNKNOWN_FIELD',
          message: 'Query parameters are not allowed on this endpoint.',
        }))
      )
    );
  }
  return next();
}

function validateBody(schema) {
  return (req, res, next) => {
    if (req.missingJsonContentType) {
      return next(
        new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
      );
    }
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(mapZodError(result.error));
    }
    req.validatedBody = result.data;
    return next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(mapZodError(result.error, 'query'));
    }
    req.validatedQuery = result.data;
    return next();
  };
}

function parseQueryInt(value, field, min, max) {
  if (typeof value !== 'string' || !BASE10_INT_REGEX.test(value)) {
    return { error: { field: `query.${field}`, code: 'FORMAT', message: 'Must be a base-10 integer.' } };
  }
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    return {
      error: { field: `query.${field}`, code: 'RANGE', message: `Must be between ${min} and ${max}.` },
    };
  }
  return { value: num };
}

function validateImageUrl(url, { isProduction, approvedOrigins = [] } = {}) {
  if (url === null) return { valid: true };
  if (typeof url !== 'string' || url.length > 2048) {
    return { valid: false, message: 'imageUrl must be null or an HTTPS URL <= 2048 characters.' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return { valid: false, message: 'imageUrl must be a valid absolute HTTPS URL.' };
  }
  if (parsed.protocol !== 'https:') {
    return { valid: false, message: 'imageUrl must use HTTPS.' };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, message: 'imageUrl must not contain credentials.' };
  }
  if (parsed.port && parsed.port !== '443') {
    return { valid: false, message: 'imageUrl must not use a nonstandard port.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  ) {
    return { valid: false, message: 'imageUrl cannot target private or loopback addresses.' };
  }
  if (isProduction) {
    if (!approvedOrigins.includes(parsed.origin)) {
      return { valid: false, message: 'imageUrl origin is not in the approved image CDN allowlist.' };
    }
  }
  return { valid: true };
}

module.exports = {
  UUID_REGEX,
  IDEMPOTENCY_KEY_REGEX,
  SKU_REGEX,
  BASE10_INT_REGEX,
  normalizeText,
  codePointLength,
  nfcString,
  uuidSchema,
  moneySchema,
  positivePriceSchema,
  qtySchema,
  versionSchema,
  addressSchema,
  validateUuidParam,
  validateIdempotencyKeyHeader,
  requireEmptyQuery,
  validateBody,
  validateQuery,
  parseQueryInt,
  validateImageUrl,
};
