import type { NextFunction, Request, Response } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

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

function parsePositiveIntEnv(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null) return defaultValue;
  const raw = typeof value === 'string' ? value.trim() : String(value);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.trunc(parsed);
}

function isSafeMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS';
}

function wantsHtml(req: Request): boolean {
  const accept = String(req.header('accept') || '').toLowerCase();
  return accept.includes('text/html');
}

type CachedLimiter = {
  key: string;
  handler: RateLimitRequestHandler;
};

let cachedLimiter: CachedLimiter | null = null;
let cachedEnabled = false;

function buildCacheKey(enabled: boolean, windowMs: number, max: number): string {
  return JSON.stringify({ enabled, windowMs, max });
}

function createLimiter(windowMs: number, max: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit: max,
    keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? '')}`,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      const resetTime = (req as any)?.rateLimit?.resetTime instanceof Date ? (req as any).rateLimit.resetTime : null;
      const retryAfterSeconds = resetTime ? Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : null;

      res.setHeader('Cache-Control', 'no-store');
      if (retryAfterSeconds !== null) res.setHeader('Retry-After', String(retryAfterSeconds));

      const message = 'Too many admin write requests. Please retry later.';

      if (wantsHtml(req)) {
        res.status(429).type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Too Many Requests</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 2rem; line-height: 1.4; }
      code { background: #f4f4f5; padding: 0.1rem 0.3rem; border-radius: 4px; }
      .box { max-width: 720px; padding: 1rem 1.25rem; border: 1px solid #e4e4e7; border-radius: 10px; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>Too Many Requests</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`);
        return;
      }

      res.status(429).json({
        code: 'ADMIN_RATE_LIMITED',
        message,
        retry_after_s: retryAfterSeconds,
        request_id: getRequestId(req, res),
      });
    },
  });
}

function initAdminWriteRateLimitFromEnv(): void {
  const enabled = parseBooleanEnv(process.env.ADMIN_RATE_LIMIT_ENABLED, false);
  cachedEnabled = enabled;

  if (!enabled) {
    cachedLimiter = null;
    return;
  }

  const windowMs = parsePositiveIntEnv(process.env.ADMIN_RATE_LIMIT_WINDOW_MS, 60_000);
  const max = parsePositiveIntEnv(process.env.ADMIN_RATE_LIMIT_MAX, 20);

  const key = buildCacheKey(enabled, windowMs, max);
  if (cachedLimiter?.key === key) return;

  cachedLimiter = { key, handler: createLimiter(windowMs, max) };
}

initAdminWriteRateLimitFromEnv();

export default function adminWriteRateLimit(req: Request, res: Response, next: NextFunction) {
  initAdminWriteRateLimitFromEnv();

  if (!cachedEnabled || !cachedLimiter) {
    next();
    return;
  }

  if (isSafeMethod(req.method)) {
    next();
    return;
  }

  cachedLimiter.handler(req, res, next);
}
