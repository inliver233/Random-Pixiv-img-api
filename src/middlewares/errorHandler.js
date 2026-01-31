const { STATUS_CODES } = require('http');

const logger = require('../logger/logger');

function getRequestId(req, res) {
  return req.request_id || res.locals.request_id;
}

function wantsJson(req) {
  const path = req.path || '';
  const accept = req.get('accept') || '';
  const acceptJson = accept.includes('application/json');

  if (path.startsWith('/random')) {
    const format = req.query && req.query.format;
    return acceptJson || format === 'json' || (Array.isArray(format) && format.includes('json'));
  }

  return (
    path.startsWith('/images')
    || path.startsWith('/admin')
    || path.startsWith('/metrics')
    || path.startsWith('/healthz')
  );
}

function normalizeError(err) {
  const statusCandidate = Number(err && (err.status ?? err.statusCode));
  const status = Number.isFinite(statusCandidate) && statusCandidate >= 400 && statusCandidate <= 599 ? statusCandidate : 500;

  const codeFromError = typeof (err && err.code) === 'string' && err.code ? err.code : null;
  const codeFromStatus = status === 400
    ? 'BAD_REQUEST'
    : status === 401
      ? 'UNAUTHORIZED'
      : status === 403
        ? 'FORBIDDEN'
        : status === 404
          ? 'NOT_FOUND'
          : status === 429
            ? 'RATE_LIMIT'
            : status >= 500
              ? 'INTERNAL_SERVER_ERROR'
              : 'ERROR';

  const message = status >= 500 ? 'Internal Server Error' : (err && err.message ? err.message : 'Error');

  return {
    status,
    code: codeFromError || codeFromStatus,
    message,
  };
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const requestId = getRequestId(req, res);
  const normalized = normalizeError(err);

  logger.error(
    {
      request_id: requestId,
      err,
      status: normalized.status,
      code: normalized.code,
      route: req.route && req.route.path ? `${req.baseUrl || ''}${req.route.path}` : req.path,
    },
    'error',
  );

  if (wantsJson(req)) {
    res.status(normalized.status).json({
      code: normalized.code,
      message: normalized.message,
      request_id: requestId,
    });
    return;
  }

  const title = `${normalized.status} ${STATUS_CODES[normalized.status] || 'Error'}`;
  res.status(normalized.status).render('error', {
    error_title: title,
    message_en: normalized.message,
    message_zh: '',
    request_id: requestId,
  });
}

module.exports = errorHandler;
