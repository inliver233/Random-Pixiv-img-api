import type { NextFunction, Request, Response } from 'express';

import { getEnv } from '../config/env';

type AllowedOrigins = {
  wildcard: boolean;
  origins: string[];
};

function parseAllowedOrigins(value: string): AllowedOrigins {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '*') return { wildcard: true, origins: [] };

  const origins = trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

  return { wildcard: false, origins };
}

function isAdminPath(req: Request): boolean {
  const path = (req.path || req.originalUrl || '').toString();
  return path.startsWith('/admin');
}

export default function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const env = getEnv();
  const config = isAdminPath(req) ? env.CORS_ADMIN_ALLOWED_ORIGINS : env.CORS_ALLOWED_ORIGINS;
  const allow = parseAllowedOrigins(config);

  const requestOrigin = String(req.headers.origin || '').trim();
  if (allow.wildcard) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (requestOrigin && allow.origins.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.append('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

    const requestedHeaders = req.headers['access-control-request-headers'];
    if (requestedHeaders) {
      res.setHeader('Access-Control-Allow-Headers', Array.isArray(requestedHeaders) ? requestedHeaders.join(',') : String(requestedHeaders));
    }

    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
    return;
  }

  next();
}

