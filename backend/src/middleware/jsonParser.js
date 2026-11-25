const { AppError, validationError } = require('../config/errors');

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Lightweight recursive-descent JSON lexer/validator to detect duplicate object keys
 * and prototype-pollution keys before JSON.parse.
 */
function inspectRawJsonForDuplicatesAndProto(text) {
  let i = 0;
  const len = text.length;

  function skipWs() {
    while (i < len) {
      const ch = text.charCodeAt(i);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) i += 1;
      else break;
    }
  }

  function parseString() {
    if (text[i] !== '"') throw new SyntaxError('Expected string');
    const start = i;
    i += 1;
    while (i < len) {
      const ch = text[i];
      if (ch === '\\') {
        i += 2;
      } else if (ch === '"') {
        i += 1;
        return JSON.parse(text.slice(start, i));
      } else {
        i += 1;
      }
    }
    throw new SyntaxError('Unterminated string');
  }

  function parseValue() {
    skipWs();
    if (i >= len) throw new SyntaxError('Unexpected end of JSON');
    const ch = text[i];
    if (ch === '{') {
      parseObject();
    } else if (ch === '[') {
      parseArray();
    } else if (ch === '"') {
      parseString();
    } else if (ch === 't') {
      if (text.slice(i, i + 4) !== 'true') throw new SyntaxError('Invalid literal');
      i += 4;
    } else if (ch === 'f') {
      if (text.slice(i, i + 5) !== 'false') throw new SyntaxError('Invalid literal');
      i += 5;
    } else if (ch === 'n') {
      if (text.slice(i, i + 4) !== 'null') throw new SyntaxError('Invalid literal');
      i += 4;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      parseNumber();
    } else {
      throw new SyntaxError(`Unexpected token ${ch}`);
    }
  }

  function parseNumber() {
    const start = i;
    if (text[i] === '-') i += 1;
    while (i < len && text[i] >= '0' && text[i] <= '9') i += 1;
    if (text[i] === '.') {
      i += 1;
      while (i < len && text[i] >= '0' && text[i] <= '9') i += 1;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i += 1;
      if (text[i] === '+' || text[i] === '-') i += 1;
      while (i < len && text[i] >= '0' && text[i] <= '9') i += 1;
    }
    const rawNum = text.slice(start, i);
    const num = Number(rawNum);
    if (!Number.isFinite(num)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed.', [
        { field: '$', code: 'FORMAT', message: 'Non-finite number is not allowed.' },
      ]);
    }
  }

  function parseObject() {
    i += 1; // '{'
    skipWs();
    const seen = new Set();
    if (text[i] === '}') {
      i += 1;
      return;
    }
    while (i < len) {
      skipWs();
      const key = parseString();
      if (FORBIDDEN_KEYS.has(key)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed.', [
          { field: key, code: 'UNKNOWN_FIELD', message: 'Forbidden object key.' },
        ]);
      }
      if (seen.has(key)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed.', [
          { field: key, code: 'FORMAT', message: 'Duplicate JSON key is not allowed.' },
        ]);
      }
      seen.add(key);
      skipWs();
      if (text[i] !== ':') throw new SyntaxError('Expected colon');
      i += 1;
      parseValue();
      skipWs();
      if (text[i] === ',') {
        i += 1;
      } else if (text[i] === '}') {
        i += 1;
        return;
      } else {
        throw new SyntaxError('Expected comma or closing brace');
      }
    }
    throw new SyntaxError('Unterminated object');
  }

  function parseArray() {
    i += 1; // '['
    skipWs();
    if (text[i] === ']') {
      i += 1;
      return;
    }
    while (i < len) {
      parseValue();
      skipWs();
      if (text[i] === ',') {
        i += 1;
      } else if (text[i] === ']') {
        i += 1;
        return;
      } else {
        throw new SyntaxError('Expected comma or closing bracket');
      }
    }
    throw new SyntaxError('Unterminated array');
  }

  parseValue();
  skipWs();
  if (i !== len) throw new SyntaxError('Unexpected trailing characters');
}

function rejectDuplicateQueryParams(req, res, next) {
  const rawQuery = req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '';
  if (!rawQuery) return next();

  const seen = new Set();
  const pairs = rawQuery.split('&').filter(Boolean);
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    let key;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    } catch (_) {
      return next(
        validationError([{ field: 'query', code: 'FORMAT', message: 'Malformed query string encoding.' }])
      );
    }
    if (seen.has(key)) {
      return next(
        validationError([{ field: `query.${key}`, code: 'FORMAT', message: 'Duplicate query parameter.' }])
      );
    }
    seen.add(key);
  }
  return next();
}

function strictJsonBodyMiddleware(maxBytes = 16 * 1024) {
  return (req, res, next) => {
    const method = req.method.toUpperCase();
    const isMutation = method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';

    if (!isMutation) {
      req.body = undefined;
      return next();
    }

    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (!contentType) {
      req.missingJsonContentType = true;
      req.body = undefined;
      return next();
    }
    if (!contentType.startsWith('application/json')) {
      return next(
        new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
      );
    }

    const contentEncoding = (req.headers['content-encoding'] || '').toLowerCase();
    if (contentEncoding && contentEncoding !== 'identity') {
      return next(
        new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Compressed request bodies are not supported.')
      );
    }

    const chunks = [];
    let totalBytes = 0;
    let exceeded = false;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        exceeded = true;
        req.pause();
        next(new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request payload exceeds maximum allowed size.'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (exceeded) return;
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) {
        return next(
          validationError([{ field: '$', code: 'FORMAT', message: 'Request body must be valid JSON.' }])
        );
      }
      let text;
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        text = decoder.decode(buf);
      } catch (_) {
        return next(
          validationError([{ field: '$', code: 'FORMAT', message: 'Request body must be valid UTF-8.' }])
        );
      }

      try {
        inspectRawJsonForDuplicatesAndProto(text);
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return next(
            validationError([{ field: '$', code: 'TYPE', message: 'Request body must be a JSON object.' }])
          );
        }
        req.body = parsed;
        return next();
      } catch (err) {
        if (err instanceof AppError) return next(err);
        return next(
          validationError([{ field: '$', code: 'FORMAT', message: 'Malformed JSON body.' }])
        );
      }
    });

    req.on('error', () => {
      if (!exceeded) {
        next(validationError([{ field: '$', code: 'FORMAT', message: 'Failed to read request body.' }]));
      }
    });
  };
}

module.exports = {
  strictJsonBodyMiddleware,
  rejectDuplicateQueryParams,
  inspectRawJsonForDuplicatesAndProto,
};
