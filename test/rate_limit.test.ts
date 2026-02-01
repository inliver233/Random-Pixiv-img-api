import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import rateLimitMiddleware, { getRateLimitStateForTest, resetRateLimitForTest } from '../src/middlewares/rateLimit.ts';
import { getEnv, resetEnvForTest } from '../src/config/env.js';

function createApp() {
  const app = express();

  app.use(['/random', '/i', '/images'], rateLimitMiddleware);

  app.get('/random', (_req, res) => res.status(200).send('ok'));
  app.get('/i/:id.:ext', (_req, res) => res.status(200).send('ok'));
  app.get('/images/:id', (_req, res) => res.status(200).json({ ok: true }));

  return app;
}

describe('rateLimitMiddleware', () => {
  const keys = [
    'RATE_LIMIT_ENABLED',
    'RATE_LIMIT_WINDOW_MS',
    'RATE_LIMIT_MAX',
    'RATE_LIMIT_MAX_API_KEY',
    'RATE_LIMIT_API_KEYS',
  ] as const;

  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      originalEnv[key] = process.env[key];
    }

    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX = '2';
    process.env.RATE_LIMIT_MAX_API_KEY = '5';
    process.env.RATE_LIMIT_API_KEYS = 'premium123';

    resetEnvForTest();
    resetRateLimitForTest();

    const env = getEnv();
    expect(env.RATE_LIMIT_ENABLED).toBe(true);
    expect(env.RATE_LIMIT_MAX).toBe(2);
    expect(env.RATE_LIMIT_MAX_API_KEY).toBe(5);
    expect(env.RATE_LIMIT_API_KEYS).toBe('premium123');

    expect(getRateLimitStateForTest()).toEqual({ enabled: true, initialized: true });
  });

  afterEach(() => {
    for (const key of keys) {
      const prev = originalEnv[key];
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
    resetEnvForTest();
    resetRateLimitForTest();
  });

  it('returns 429 + Retry-After after limit is reached (IP-based)', async () => {
    const app = createApp();

    const first = await request(app).get('/random').expect(200);
    expect(first.headers.ratelimit).toBeDefined();
    await request(app).get('/random').expect(200);

    const res = await request(app).get('/random').expect(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('allows higher quota for valid API key', async () => {
    const app = createApp();

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).get('/random').set('x-api-key', 'premium123').expect(200);
      expect(res.headers.ratelimit).toBeDefined();
    }

    const res = await request(app).get('/random').set('x-api-key', 'premium123').expect(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
