const logger = require('../logger/logger');

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
  });

  next();
}

module.exports = httpLoggerMiddleware;

