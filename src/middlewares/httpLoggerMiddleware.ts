import type { NextFunction, Request, Response } from 'express';

import logger from '../logger/logger';
import { incrementHttpRequestsTotal } from '../metrics/httpMetrics';

function getRouteLabel(req: Request): string {
  const maybeRoute = (req as any).route;
  if (maybeRoute?.path) return `${req.baseUrl || ''}${maybeRoute.path}`;
  return req.path;
}

export default function httpLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const requestId = (req as any).request_id || res.locals.request_id;

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
    } catch (err: unknown) {
      logger.warn({ err: { message: err instanceof Error ? err.message : String(err) } }, 'metrics http_requests_total failed');
    }
  });

  next();
}
