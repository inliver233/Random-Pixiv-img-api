import type { NextFunction, Request, Response } from 'express';

import logger from '../logger/logger';
import { incrementHttpRequestsTotal, observeRequestDurationSeconds } from '../metrics/httpMetrics';

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
    const routeLabel = getRouteLabel(req);

    logger.info(
      {
        request_id: requestId,
        method: req.method,
        route: routeLabel,
        status: res.statusCode,
        latency_ms: Math.round(durationMs),
      },
      'request',
    );

    const enabled = String(process.env.METRICS_ENABLED || '').trim().toLowerCase();
    if (['0', 'false', 'no', 'n', 'off'].includes(enabled)) return;

    try {
      incrementHttpRequestsTotal(req, res);
      observeRequestDurationSeconds(req, res, durationMs / 1000);
    } catch (err: unknown) {
      logger.warn({ err: { message: err instanceof Error ? err.message : String(err) } }, 'metrics http_requests_total failed');
    }

    const requestLogEnabled = String(process.env.REQUEST_LOG_ENABLED || '').trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(requestLogEnabled)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { maybeRecordRequestLog } = require('../services/requestLogService') as typeof import('../services/requestLogService');
        void maybeRecordRequestLog({ req, res, routeLabel, durationMs: Math.round(durationMs) });
      } catch (err: unknown) {
        logger.warn({ err }, 'request_log init failed');
      }
    }
  });

  next();
}
