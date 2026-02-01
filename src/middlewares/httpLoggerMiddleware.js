const logger = require('../logger/logger');
const { incrementHttpRequestsTotal } = require('../metrics/httpMetrics');

function getRouteLabel(req) {
  if (req.route && req.route.path) return `${req.baseUrl || ''}${req.route.path}`;
  return req.path;
}

function httpLoggerMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const requestId = req.request_id || res.locals.request_id;

    logger.info(
      {
        request_id: requestId,
        method: req.method,
        route: getRouteLabel(req),
        status: res.statusCode,
        latency_ms: Math.round(durationMs),
      },
      'request',
    );

    const enabled = String(process.env.METRICS_ENABLED || '').trim().toLowerCase();
    if (['0', 'false', 'no', 'n', 'off'].includes(enabled)) return;

    try {
      incrementHttpRequestsTotal(req, res);
    } catch (err) {
      logger.warn({ err: { message: err?.message } }, 'metrics http_requests_total failed');
    }
  });

  next();
}

module.exports = httpLoggerMiddleware;
