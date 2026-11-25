require('dotenv').config();
const crypto = require('crypto');

function parseList(value, fallback = []) {
  if (!value || typeof value !== 'string') return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePem(value) {
  if (!value) return null;
  if (value.includes('BEGIN ')) {
    return value.replace(/\\n/g, '\n');
  }
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (decoded.includes('BEGIN ')) return decoded;
  } catch (_) {
    // ignore
  }
  return value;
}

function generateEphemeralEs256KeyPair() {
  return crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  let jwtPrivateKey = normalizePem(env.JWT_PRIVATE_KEY_PEM);
  let jwtPublicKey = normalizePem(env.JWT_PUBLIC_KEY_PEM);

  if (!jwtPrivateKey || !jwtPublicKey) {
    if (isProduction) {
      throw new Error('JWT_PRIVATE_KEY_PEM and JWT_PUBLIC_KEY_PEM are required in production.');
    }
    const generated = generateEphemeralEs256KeyPair();
    jwtPrivateKey = generated.privateKey;
    jwtPublicKey = generated.publicKey;
  }

  let masterKeyBuffer = null;
  if (env.ENCRYPTION_MASTER_KEY) {
    const raw = env.ENCRYPTION_MASTER_KEY.trim();
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      masterKeyBuffer = Buffer.from(raw, 'hex');
    } else {
      const b64 = Buffer.from(raw, 'base64');
      if (b64.length === 32) {
        masterKeyBuffer = b64;
      }
    }
  }
  if (!masterKeyBuffer) {
    if (isProduction) {
      throw new Error('ENCRYPTION_MASTER_KEY (32 bytes hex or base64) is required in production.');
    }
    // Deterministic dev/test fallback key (never used in production)
    masterKeyBuffer = crypto.createHash('sha256').update('ecommerce-dev-test-master-key-v1').digest();
  }

  let mailMasterKeyBuffer = null;
  if (env.MAIL_ENCRYPTION_MASTER_KEY) {
    const raw = env.MAIL_ENCRYPTION_MASTER_KEY.trim();
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      mailMasterKeyBuffer = Buffer.from(raw, 'hex');
    } else {
      const b64 = Buffer.from(raw, 'base64');
      if (b64.length === 32) {
        mailMasterKeyBuffer = b64;
      }
    }
  }
  if (!mailMasterKeyBuffer) {
    if (isProduction) {
      throw new Error('MAIL_ENCRYPTION_MASTER_KEY (32 bytes hex or base64) is required in production.');
    }
    // Separate deterministic dev/test fallback key for mail outbox isolation
    mailMasterKeyBuffer = crypto.createHash('sha256').update('ecommerce-dev-test-mail-master-key-v1').digest();
  }

  let authEmailHmacSecret = env.AUTH_EMAIL_HMAC_SECRET || '';
  if (!authEmailHmacSecret) {
    if (isProduction) {
      throw new Error('AUTH_EMAIL_HMAC_SECRET is required in production.');
    }
    authEmailHmacSecret = 'ecommerce-dev-test-email-hmac-secret-v1';
  }

  const stripeSecretKey = env.STRIPE_SECRET_KEY || '';
  if (stripeSecretKey && stripeSecretKey.startsWith('sk_live_')) {
    throw new Error('Live Stripe secret keys are prohibited in this test-mode deployment.');
  }

  const appOrigin = (env.APP_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
  const allowedOrigins = parseList(env.ALLOWED_ORIGINS, [appOrigin]).map((o) => o.replace(/\/+$/, ''));

  const config = {
    nodeEnv,
    isProduction,
    isTest,
    port: Number.parseInt(env.PORT || '4000', 10),
    appOrigin,
    allowedOrigins,
    trustProxy:
      !env.TRUST_PROXY || env.TRUST_PROXY === 'false'
        ? false
        : env.TRUST_PROXY === 'true'
          ? 1
          : /^[0-9]+$/.test(env.TRUST_PROXY)
            ? Number.parseInt(env.TRUST_PROXY, 10)
            : env.TRUST_PROXY,
    databaseUrl: env.DATABASE_URL || '',
    cookies: {
      sessionName: isProduction ? '__Host-session' : 'dev_session',
      oauthName: isProduction ? '__Host-oauth' : 'dev_oauth',
      preauthName: isProduction ? '__Host-preauth' : 'dev_preauth',
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      sessionMaxAgeSec: 900,
      oauthMaxAgeSec: 300,
      preauthMaxAgeSec: 900,
    },
    jwt: {
      issuer: 'ecommerce-api',
      audience: 'ecommerce-web',
      keyId: 'key-2026-01',
      privateKey: jwtPrivateKey,
      publicKey: jwtPublicKey,
      ttlSec: 900,
      clockToleranceSec: 60,
    },
    encryption: {
      keyId: 'local-kms-key-1',
      masterKey: masterKeyBuffer,
    },
    mailEncryption: {
      keyId: 'local-mail-kms-key-1',
      masterKey: mailMasterKeyBuffer,
    },
    auth: {
      emailHmacSecret: authEmailHmacSecret,
      verifyTokenTtlSec: 30 * 60,
      resetTokenTtlSec: 15 * 60,
      maxActiveTokensPerPurpose: 3,
      argon2: {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      },
      hashMaxConcurrency: 4,
    },
    mail: {
      transport: env.MAIL_TRANSPORT || (isProduction ? 'smtp' : 'fake'),
      from: env.MAIL_FROM || 'no-reply@example.test',
      smtpHost: env.SMTP_HOST || '',
      smtpPort: Number.parseInt(env.SMTP_PORT || '587', 10),
      smtpSecure: env.SMTP_SECURE === 'true',
      smtpUser: env.SMTP_USER || '',
      smtpPass: env.SMTP_PASS || '',
      timeoutMs: 10000,
      maxAttempts: 5,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID || '',
      clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/v1/auth/google/callback',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      issuer: 'https://accounts.google.com',
    },
    stripe: {
      secretKey: stripeSecretKey,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
      webhookSecretPrevious: env.STRIPE_WEBHOOK_SECRET_PREVIOUS || '',
    },
    approvedImageCdnOrigins: parseList(env.APPROVED_IMAGE_CDN_ORIGINS, []),
    ai: {
      enabled: env.AI_SUPPORT_ENABLED === 'true',
      provider: 'gemini',
      apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: env.GEMINI_API_KEY || env.LLM_PROVIDER_API_KEY || '',
      model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      dailyBudgetCents: 500,
      timeoutMs: 15000,
    },
    worker: {
      pollIntervalMs: 5000,
    },
  };

  return config;
}

const config = loadConfig();

module.exports = {
  config,
  loadConfig,
};
