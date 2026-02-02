import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTest } from '../src/config/env';
import corsMiddleware from '../src/middlewares/cors.ts';

function createApp() {
  const app = express();
  app.use(corsMiddleware);
  app.get('/random', (_req, res) => res.status(200).json({ ok: true }));
  app.get('/admin/ping', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe('corsMiddleware', () => {
  beforeEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.CORS_ADMIN_ALLOWED_ORIGINS;
    resetEnvForTest();
  });

  afterEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.CORS_ADMIN_ALLOWED_ORIGINS;
    resetEnvForTest();
  });

  it('defaults to wildcard (*) to match legacy behavior', async () => {
    const app = createApp();

    const res = await request(app).get('/random').expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('supports an allowlist for public endpoints', async () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://a.example, https://b.example';
    resetEnvForTest();

    const app = createApp();

    const ok = await request(app)
      .get('/random')
      .set('origin', 'https://a.example')
      .expect(200);

    expect(ok.headers['access-control-allow-origin']).toBe('https://a.example');
    expect(ok.headers.vary).toContain('Origin');

    const blocked = await request(app)
      .get('/random')
      .set('origin', 'https://c.example')
      .expect(200);

    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('supports a separate allowlist for /admin', async () => {
    process.env.CORS_ALLOWED_ORIGINS = '*';
    process.env.CORS_ADMIN_ALLOWED_ORIGINS = 'https://admin.example';
    resetEnvForTest();

    const app = createApp();

    const publicRes = await request(app)
      .get('/random')
      .set('origin', 'https://any.example')
      .expect(200);

    expect(publicRes.headers['access-control-allow-origin']).toBe('*');

    const adminOk = await request(app)
      .get('/admin/ping')
      .set('origin', 'https://admin.example')
      .expect(200);

    expect(adminOk.headers['access-control-allow-origin']).toBe('https://admin.example');

    const adminBlocked = await request(app)
      .get('/admin/ping')
      .set('origin', 'https://any.example')
      .expect(200);

    expect(adminBlocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});

