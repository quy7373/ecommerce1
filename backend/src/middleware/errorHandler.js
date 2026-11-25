const { AppError, formatErrorBody } = require('../config/errors');

function methodNotAllowed(allowedMethods) {
  const allowHeader = allowedMethods.join(', ');
  return (req, res, next) => {
    res.setHeader('Allow', allowHeader);
    next(new AppError(405, 'METHOD_NOT_ALLOWED', `Method ${req.method} is not allowed on this route.`));
  };
}

function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'));
}

function errorHandler(err, req, res, _next) {
  const requestId = req.requestId;
  res.setHeader('Cache-Control', 'no-store');

  if (err instanceof AppError) {
    if (err.extraHeaders) {
      for (const [k, v] of Object.entries(err.extraHeaders)) {
        res.setHeader(k, v);
      }
    }
    return res.status(err.status).json(
      formatErrorBody({
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      })
    );
  }

  // Handle Prisma known constraint errors safely without leaking SQL/columns
  if (err && typeof err.code === 'string' && err.code.startsWith('P')) {
    if (err.code === 'P2002') {
      return res.status(409).json(
        formatErrorBody({
          code: 'CONFLICT',
          message: 'A conflicting resource already exists.',
          details: [],
          requestId,
        })
      );
    }
    if (err.code === 'P2025') {
      return res.status(404).json(
        formatErrorBody({
          code: 'NOT_FOUND',
          message: 'The requested resource was not found.',
          details: [],
          requestId,
        })
      );
    }
  }

  // Safe redacted server error logging (never log cookies, tokens, or raw bodies)
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[${requestId}] Unhandled error:`, err?.message || 'Unknown error');
  }

  return res.status(500).json(
    formatErrorBody({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred.',
      details: [],
      requestId,
    })
  );
}

module.exports = {
  methodNotAllowed,
  notFoundHandler,
  errorHandler,
};
