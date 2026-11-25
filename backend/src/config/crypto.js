const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { config } = require('./env');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hmacSha256Hex(value, secret) {
  return crypto.createHmac('sha256', String(secret)).update(String(value), 'utf8').digest('hex');
}

function hmacToPgBigIntKey(value, secret) {
  const digest = crypto.createHmac('sha256', String(secret)).update(String(value), 'utf8').digest();
  // Signed 64-bit integer for pg_advisory_xact_lock(bigint)
  return digest.readBigInt64BE(0);
}

function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function buildAad({ entity, rowId, field, env = config.nodeEnv, encVersion = 1 }) {
  return Buffer.from(`${env}|${entity}|${rowId}|${field}|v${encVersion}`, 'utf8');
}

function wrapDataKey(dataKey, masterKey = config.encryption.masterKey) {
  const wrapIv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, wrapIv);
  const encrypted = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([wrapIv, tag, encrypted]).toString('base64url');
}

function unwrapDataKey(wrappedKeyB64, masterKey = config.encryption.masterKey) {
  const raw = Buffer.from(wrappedKeyB64, 'base64url');
  if (raw.length < 12 + 16 + 32) {
    throw new Error('Invalid wrapped data key');
  }
  const wrapIv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, wrapIv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * AES-256-GCM envelope encryption conforming to docs/security/data-protection.md:
 * { encVersion: 1, keyId, wrappedKey, iv, ciphertext, tag }
 */
function encryptEnvelope(plaintextObjOrString, aadContext, options = {}) {
  const keyId = options.keyId || config.encryption.keyId;
  const masterKey = options.masterKey || config.encryption.masterKey;
  const dataKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const aad = buildAad({ ...aadContext, encVersion: 1 });
  const plaintext =
    typeof plaintextObjOrString === 'string'
      ? plaintextObjOrString
      : JSON.stringify(plaintextObjOrString);

  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encVersion: 1,
    keyId,
    wrappedKey: wrapDataKey(dataKey, masterKey),
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: tag.toString('base64url'),
  };
}

function decryptEnvelope(envelope, aadContext, options = {}) {
  if (!envelope || typeof envelope !== 'object' || envelope.encVersion !== 1) {
    throw new Error('Invalid encryption envelope');
  }
  const masterKey = options.masterKey || config.encryption.masterKey;
  const dataKey = unwrapDataKey(envelope.wrappedKey, masterKey);
  const iv = Buffer.from(envelope.iv, 'base64url');
  const tag = Buffer.from(envelope.tag, 'base64url');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
  const aad = buildAad({ ...aadContext, encVersion: envelope.encVersion });

  const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return plaintext;
}

function signSessionJwt({ userId, sessionId, nowSec = Math.floor(Date.now() / 1000) }, jwtConfig = config.jwt) {
  const payload = {
    sub: userId,
    sid: sessionId,
    iat: nowSec,
    exp: nowSec + jwtConfig.ttlSec,
  };
  return jwt.sign(payload, jwtConfig.privateKey, {
    algorithm: 'ES256',
    issuer: jwtConfig.issuer,
    audience: jwtConfig.audience,
    keyid: jwtConfig.keyId,
  });
}

function verifySessionJwt(token, jwtConfig = config.jwt) {
  const decodedHeader = jwt.decode(token, { complete: true });
  if (!decodedHeader || !decodedHeader.header) {
    throw new Error('Malformed JWT');
  }
  if (decodedHeader.header.alg !== 'ES256' || decodedHeader.header.kid !== jwtConfig.keyId) {
    throw new Error('Unsupported JWT algorithm or unknown key ID');
  }
  const verified = jwt.verify(token, jwtConfig.publicKey, {
    algorithms: ['ES256'],
    issuer: jwtConfig.issuer,
    audience: jwtConfig.audience,
    clockTolerance: jwtConfig.clockToleranceSec,
  });

  if (
    !verified ||
    typeof verified !== 'object' ||
    typeof verified.sub !== 'string' ||
    typeof verified.sid !== 'string' ||
    typeof verified.iat !== 'number' ||
    typeof verified.exp !== 'number'
  ) {
    throw new Error('Invalid JWT claims');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (verified.iat > nowSec + jwtConfig.clockToleranceSec || verified.exp - verified.iat > jwtConfig.ttlSec) {
    throw new Error('JWT lifetime bounds exceeded');
  }

  return verified;
}

function canonicalizeJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(value[k])}`).join(',')}}`;
}

module.exports = {
  sha256Hex,
  hmacSha256Hex,
  hmacToPgBigIntKey,
  randomBase64Url,
  constantTimeEqual,
  buildAad,
  encryptEnvelope,
  decryptEnvelope,
  signSessionJwt,
  verifySessionJwt,
  canonicalizeJson,
};
