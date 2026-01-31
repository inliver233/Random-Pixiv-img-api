import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export default function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const requestId = incoming && incoming.trim() ? incoming.trim() : crypto.randomUUID();

  (req as any).request_id = requestId;
  res.locals.request_id = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
}

