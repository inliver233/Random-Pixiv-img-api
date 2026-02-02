import type { NextFunction, Request, Response } from 'express';

function getRequestId(req: Request, res: Response): string | undefined {
  return (req as any).request_id || res.locals.request_id;
}

function parseBooleanEnv(value: unknown, defaultValue: boolean): boolean {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function normalizeOrigin(value: string): string | null {
  const raw = value.trim();
  if (!raw || raw === 'null') return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function parseAllowedOrigins(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const raw = value.trim();
  if (!raw) return [];
  const out: string[] = [];

  for (const token of raw.split(/[,\s|]+/g)) {
    const normalized = normalizeOrigin(token);
    if (normalized) out.push(normalized);
  }

  return Array.from(new Set(out));
}

function extractRequestOrigin(req: Request): string | null {
  const originHeader = req.header('origin');
  if (typeof originHeader === 'string') {
    const normalized = normalizeOrigin(originHeader);
    if (normalized) return normalized;
  }

  const referer = req.header('referer') || req.header('referrer');
  if (typeof referer !== 'string') return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function hasAdminAuthCookie(req: Request): boolean {
  const cookie = req.header('cookie') || '';
  if (!cookie) return false;
  return cookie.includes('pixivcat_admin_sid=') || cookie.includes('admin_token=');
}

function isSafeMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS';
}

function wantsHtml(req: Request): boolean {
  const accept = String(req.header('accept') || '').toLowerCase();
  return accept.includes('text/html');
}

function deny(req: Request, res: Response, code: string, message: string): void {
  res.setHeader('Cache-Control', 'no-store');

  if (wantsHtml(req)) {
    res.status(403).type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Forbidden</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 2rem; line-height: 1.4; }
      code { background: #f4f4f5; padding: 0.1rem 0.3rem; border-radius: 4px; }
      .box { max-width: 720px; padding: 1rem 1.25rem; border: 1px solid #e4e4e7; border-radius: 10px; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>Forbidden</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`);
    return;
  }

  res.status(403).json({
    code,
    message,
    request_id: getRequestId(req, res),
  });
}

export default function adminCsrf(req: Request, res: Response, next: NextFunction) {
  if (!parseBooleanEnv(process.env.ADMIN_CSRF_ENABLED, false)) {
    next();
    return;
  }

  if (isSafeMethod(req.method)) {
    next();
    return;
  }

  const sessionAuthenticated = Boolean((req as any)?.session?.admin);
  if (!sessionAuthenticated && !hasAdminAuthCookie(req)) {
    next();
    return;
  }

  const allowedOrigins = parseAllowedOrigins(process.env.ADMIN_CSRF_ALLOWED_ORIGINS);
  const requestOrigin = extractRequestOrigin(req);
  if (!requestOrigin) {
    deny(req, res, 'ADMIN_CSRF_BLOCKED', 'Missing Origin/Referer header.');
    return;
  }

  if (allowedOrigins.length > 0) {
    if (!allowedOrigins.includes(requestOrigin)) {
      deny(req, res, 'ADMIN_CSRF_BLOCKED', `Origin not allowed: ${requestOrigin}`);
      return;
    }
    next();
    return;
  }

  const host = req.header('host');
  if (!host) {
    deny(req, res, 'ADMIN_CSRF_BLOCKED', 'Missing Host header.');
    return;
  }

  const expectedOrigin = normalizeOrigin(`${req.protocol}://${host}`);
  if (!expectedOrigin) {
    deny(req, res, 'ADMIN_CSRF_BLOCKED', 'Unable to determine expected origin.');
    return;
  }

  if (requestOrigin !== expectedOrigin) {
    deny(req, res, 'ADMIN_CSRF_BLOCKED', `Origin mismatch: ${requestOrigin}`);
    return;
  }

  next();
}

