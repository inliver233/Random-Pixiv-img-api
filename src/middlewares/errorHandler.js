const { STATUS_CODES } = require('http');

const logger = require('../logger/logger');

function maskUrlQuery(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return raw;

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    const noHash = raw.split('#')[0] ?? raw;
    return String(noHash.split('?')[0] ?? noHash).trim();
  }
}

function maskUrlsInText(text) {
  return String(text ?? '').replace(/https?:\/\/[^\s"'<>]+/g, (match) => maskUrlQuery(match));
}

function normalizeOriginUrl(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return maskUrlQuery(trimmed);
}

function buildSafeErrorMeta(err) {
  const code = typeof (err && err.code) === 'string' && err.code ? err.code : undefined;
  const statusCandidate = Number(err && (err.status ?? err.statusCode ?? (err.response && err.response.status)));
  const status = Number.isFinite(statusCandidate) && statusCandidate > 0 ? statusCandidate : undefined;

  const messageRaw = err instanceof Error
    ? err.message
    : err && typeof err.message === 'string' && err.message
      ? err.message
      : String(err ?? '');

  const originUrl = normalizeOriginUrl(err && (err.origin_url ?? err.originUrl ?? (err.config && err.config.url)));

  return {
    ...(code ? { code } : {}),
    ...(status ? { status } : {}),
    ...(originUrl ? { origin_url: originUrl } : {}),
    message: maskUrlsInText(messageRaw),
    ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
  };
}

function normalizeErrorCode(code) {
  const raw = String(code ?? '').trim();
  if (!raw) return raw;

  if (raw === 'invalid_url' || raw === 'unsupported_url') return 'UNSUPPORTED_URL';
  if (raw === 'rate_limit') return 'UPSTREAM_RATE_LIMIT';

  return raw;
}

function getRequestId(req, res) {
  return req.request_id || res.locals.request_id;
}

function wantsJson(req) {
  if (req.__force_json_error === true) return true;

  const path = req.path || '';
  const accept = req.get('accept') || '';
  const acceptJson = accept.includes('application/json');

  if (path.startsWith('/random')) {
    const format = req.query && req.query.format;
    return acceptJson || format === 'json' || (Array.isArray(format) && format.includes('json'));
  }

  return (
    path.startsWith('/images')
    || path.startsWith('/tags')
    || path.startsWith('/authors')
    || path.startsWith('/admin')
    || path.startsWith('/metrics')
    || path.startsWith('/healthz')
  );
}

function normalizeError(err) {
  const statusCandidate = Number(err && (err.status ?? err.statusCode));
  let status = Number.isFinite(statusCandidate) && statusCandidate >= 400 && statusCandidate <= 599 ? statusCandidate : 500;

  const codeFromError = typeof (err && err.code) === 'string' && err.code ? err.code : null;
  const normalizedCodeFromError = codeFromError ? normalizeErrorCode(codeFromError) : null;
  if (normalizedCodeFromError === 'UNSUPPORTED_URL' && status === 500) status = 400;
  if (normalizedCodeFromError === 'UPSTREAM_RATE_LIMIT' && status === 500) status = 503;

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

  const message = status >= 500 ? (STATUS_CODES[status] || 'Internal Server Error') : maskUrlsInText(err && err.message ? err.message : 'Error');

  return {
    status,
    code: normalizedCodeFromError || codeFromStatus,
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
      err: buildSafeErrorMeta(err),
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
