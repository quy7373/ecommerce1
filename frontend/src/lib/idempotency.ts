/**
 * Generates an API-contract compliant Idempotency-Key (16..128 ASCII [A-Za-z0-9_-]).
 */
export function generateIdempotencyKey(prefix = 'req'): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) || 'req';
  const bytes = new Uint8Array(18);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${safePrefix}_${token}`;
}
