const crypto = require('crypto');

class AppError extends Error {
  constructor(status, code, message, details = [], extraHeaders = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = Array.isArray(details) ? details.slice(0, 50) : [];
    this.extraHeaders = extraHeaders;
  }
}

function formatErrorBody({ code, message, details = [], requestId }) {
  return {
    error: {
      code: String(code || 'INTERNAL_ERROR'),
      message: String(message || 'An unexpected error occurred.').slice(0, 500),
      details: Array.isArray(details)
        ? details.slice(0, 50).map((d) => ({
            field: String(d.field || '$'),
            code: String(d.code || 'FORMAT'),
            message: String(d.message || 'Invalid value.').slice(0, 500),
          }))
        : [],
      requestId: requestId || crypto.randomUUID(),
    },
  };
}

function validationError(details, message = 'Request validation failed.') {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

function mapZodError(zodError, fieldPrefix = '') {
  const details = zodError.issues.slice(0, 50).map((issue) => {
    let code = 'FORMAT';
    if (issue.code === 'unrecognized_keys') {
      code = 'UNKNOWN_FIELD';
    } else if (issue.code === 'invalid_type') {
      code = issue.received === 'undefined' ? 'REQUIRED' : 'TYPE';
    } else if (issue.code === 'too_small' || issue.code === 'too_big') {
      code = 'RANGE';
    }

    const basePath = issue.path && issue.path.length > 0 ? issue.path.join('.') : '';
    let field = '$';
    if (issue.code === 'unrecognized_keys' && issue.keys && issue.keys.length > 0) {
      const unknownPath = basePath ? `${basePath}.${issue.keys[0]}` : issue.keys[0];
      field = fieldPrefix ? `${fieldPrefix}.${unknownPath}` : unknownPath;
    } else if (basePath) {
      field = fieldPrefix ? `${fieldPrefix}.${basePath}` : basePath;
    } else if (fieldPrefix) {
      field = fieldPrefix;
    }

    return {
      field,
      code,
      message: issue.message || 'Invalid value.',
    };
  });

  return validationError(details);
}

module.exports = {
  AppError,
  formatErrorBody,
  validationError,
  mapZodError,
};
