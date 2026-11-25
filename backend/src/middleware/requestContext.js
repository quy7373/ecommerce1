const crypto = require('crypto');
const { config } = require('../config/env');

function requestIdMiddleware(req, res, next) {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

function securityHeadersMiddleware(req, res, next) {
  const imgCdn =
    config.approvedImageCdnOrigins.length > 0
      ? ` ${config.approvedImageCdnOrigins.join(' ')}`
      : '';
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self'${imgCdn}`,
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    ...(config.isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (config.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function noStoreMiddleware(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

module.exports = {
  requestIdMiddleware,
  securityHeadersMiddleware,
  noStoreMiddleware,
};
