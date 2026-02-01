const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const { getEnv } = require('../config/env');

let cachedLimiter = null;
let cachedEnabled = false;

function parseApiKeys(value) {
  if (!value) return new Set();
  return new Set(
    String(value)
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k !== ''),
  );
}

function getApiKey(req) {
  const header = req.get('x-api-key');
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

function buildLimiterCacheKey(env) {
  return JSON.stringify({
    enabled: env.RATE_LIMIT_ENABLED,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    maxApiKey: env.RATE_LIMIT_MAX_API_KEY,
    apiKeys: env.RATE_LIMIT_API_KEYS || '',
  });
}

function createLimiter(env) {
  const apiKeys = parseApiKeys(env.RATE_LIMIT_API_KEYS);

  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: (req) => {
      const apiKey = getApiKey(req);
      if (apiKey && apiKeys.has(apiKey)) return env.RATE_LIMIT_MAX_API_KEY;
      return env.RATE_LIMIT_MAX;
    },
    keyGenerator: (req) => {
      const apiKey = getApiKey(req);
      if (apiKey && apiKeys.has(apiKey)) return `key:${apiKey}`;
      return `ip:${ipKeyGenerator(req.ip)}`;
    },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
}

function resetRateLimitForTest() {
  initRateLimitFromEnv();
}

function rateLimitMiddleware(req, res, next) {
  if (!cachedEnabled || !cachedLimiter) {
    next();
    return;
  }

  cachedLimiter.handler(req, res, next);
}

rateLimitMiddleware.resetRateLimitForTest = resetRateLimitForTest;
rateLimitMiddleware.default = rateLimitMiddleware;

module.exports = rateLimitMiddleware;

function initRateLimitFromEnv() {
  const env = getEnv();
  const cacheKey = buildLimiterCacheKey(env);

  cachedEnabled = Boolean(env.RATE_LIMIT_ENABLED);

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
