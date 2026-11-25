const { AppError } = require('../config/errors');

class SlidingWindowRateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  reset() {
    this.buckets.clear();
  }

  consume(key, limit, windowMs = 60_000, now = Date.now()) {
    const cutoff = now - windowMs;
    let timestamps = this.buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(key, timestamps);
    }

    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= limit) {
      const oldest = timestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, retryAfterSec };
    }

    timestamps.push(now);
    return { allowed: true, retryAfterSec: 0 };
  }
}

const defaultLimiter = new SlidingWindowRateLimiter();

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function createRateLimitMiddleware({
  name,
  limit,
  windowMs = 60_000,
  keyFn,
  limiter = defaultLimiter,
}) {
  return (req, res, next) => {
    const rawKey = keyFn ? keyFn(req) : getClientIp(req);
    if (!rawKey) return next();

    const bucketKey = `${name}:${rawKey}`;
    const result = limiter.consume(bucketKey, limit, windowMs);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      return next(
        new AppError(
          429,
          'RATE_LIMITED',
          'Too many requests. Please try again later.',
          [],
          { 'Retry-After': String(result.retryAfterSec) }
        )
      );
    }
    return next();
  };
}

module.exports = {
  SlidingWindowRateLimiter,
  defaultLimiter,
  createRateLimitMiddleware,
  getClientIp,
};
