import type { NextFunction, Request, Response } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

import { getEnv } from '../config/env.js';

type CachedLimiter = {
  key: string;
  handler: RateLimitRequestHandler;
};

let cachedLimiter: CachedLimiter | null = null;
let cachedEnabled = false;

function parseApiKeys(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k !== ''),
  );
}

function getApiKey(req: Request): string | null {
  const header = req.header('x-api-key');
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

function buildLimiterCacheKey(env: ReturnType<typeof getEnv>): string {
  return JSON.stringify({
    enabled: env.RATE_LIMIT_ENABLED,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    maxApiKey: env.RATE_LIMIT_MAX_API_KEY,
    apiKeys: env.RATE_LIMIT_API_KEYS || '',
  });
}

function createLimiter(env: ReturnType<typeof getEnv>): RateLimitRequestHandler {
  const apiKeys = parseApiKeys(env.RATE_LIMIT_API_KEYS);

  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: (req: Request) => {
      const apiKey = getApiKey(req);
      if (apiKey && apiKeys.has(apiKey)) return env.RATE_LIMIT_MAX_API_KEY;
      return env.RATE_LIMIT_MAX;
    },
    keyGenerator: (req: Request) => {
      const apiKey = getApiKey(req);
      if (apiKey && apiKeys.has(apiKey)) return `key:${apiKey}`;
      return `ip:${ipKeyGenerator(req.ip)}`;
    },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
}

export function resetRateLimitForTest(): void {
  initRateLimitFromEnv();
}

export function getRateLimitStateForTest(): { enabled: boolean; initialized: boolean } {
  return { enabled: cachedEnabled, initialized: Boolean(cachedLimiter) };
}

function initRateLimitFromEnv(): void {
  const env = getEnv();

  const cacheKey = buildLimiterCacheKey(env);
  cachedEnabled = env.RATE_LIMIT_ENABLED;

  if (!cachedEnabled) {
    cachedLimiter = null;
    return;
  }

  cachedLimiter = {
    key: cacheKey,
    handler: createLimiter(env),
  };
}

initRateLimitFromEnv();

export default function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!cachedEnabled || !cachedLimiter) {
    next();
    return;
  }

  cachedLimiter.handler(req, res, next);
}
