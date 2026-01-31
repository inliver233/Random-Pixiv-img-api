import type { NextFunction, Request, Response } from 'express';

import logger from '../logger/logger';

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
  });

  next();
}

