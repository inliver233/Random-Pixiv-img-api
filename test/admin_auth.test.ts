import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import adminRoute from '../src/routes/admin.ts';
import adminAuth from '../src/middlewares/adminAuth.ts';

const require = createRequire(import.meta.url);

const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(requestIdMiddleware);
  app.use('/admin', adminRoute);
  return app;
}

describe('Admin auth (/admin)', () => {
  const prevAdminToken = process.env.ADMIN_TOKEN;
  const prevAdminIpAllowlist = process.env.ADMIN_IP_ALLOWLIST;
  const prevAdminSessionEnabled = process.env.ADMIN_SESSION_AUTH_ENABLED;
  const prevAdminSessionUser = process.env.ADMIN_SESSION_USER;
  const prevAdminSessionPass = process.env.ADMIN_SESSION_PASS;
  const prevAdminSessionSecret = process.env.ADMIN_SESSION_SECRET;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = 'test_admin_token';
    delete process.env.ADMIN_IP_ALLOWLIST;
    delete process.env.ADMIN_SESSION_AUTH_ENABLED;
    delete process.env.ADMIN_SESSION_USER;
    delete process.env.ADMIN_SESSION_PASS;
    delete process.env.ADMIN_SESSION_SECRET;
  });

  afterEach(() => {
    if (prevAdminToken === undefined) {
      delete process.env.ADMIN_TOKEN;
    } else {
      process.env.ADMIN_TOKEN = prevAdminToken;
    }

    if (prevAdminIpAllowlist === undefined) {
      delete process.env.ADMIN_IP_ALLOWLIST;
    } else {
      process.env.ADMIN_IP_ALLOWLIST = prevAdminIpAllowlist;
    }

    if (prevAdminSessionEnabled === undefined) delete process.env.ADMIN_SESSION_AUTH_ENABLED;
    else process.env.ADMIN_SESSION_AUTH_ENABLED = prevAdminSessionEnabled;

    if (prevAdminSessionUser === undefined) delete process.env.ADMIN_SESSION_USER;
    else process.env.ADMIN_SESSION_USER = prevAdminSessionUser;

    if (prevAdminSessionPass === undefined) delete process.env.ADMIN_SESSION_PASS;
    else process.env.ADMIN_SESSION_PASS = prevAdminSessionPass;

    if (prevAdminSessionSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = prevAdminSessionSecret;
  });

  it('returns 401 when token is missing', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/admin')
      .set('x-request-id', 'req-admin-no-token')
      .expect(401);

    expect(res.body).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
      request_id: 'req-admin-no-token',
    });
  });

  it('returns 401 when token is incorrect', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/admin')
      .set('authorization', 'Bearer wrong_token')
      .set('x-request-id', 'req-admin-wrong-token')
      .expect(401);

    expect(res.body).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
      request_id: 'req-admin-wrong-token',
    });
  });

  it('returns 200 when token is correct', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/admin')
      .set('authorization', 'Bearer test_admin_token')
      .set('x-request-id', 'req-admin-ok')
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ ok: true });
  });

  it('returns 403 when ADMIN_IP_ALLOWLIST denies the client ip', async () => {
    process.env.ADMIN_IP_ALLOWLIST = '10.0.0.0/8';
    const app = createApp();

    const res = await request(app)
      .get('/admin')
      .set('authorization', 'Bearer test_admin_token')
      .set('x-request-id', 'req-admin-ip-denied')
      .expect(403);

    expect(res.body).toMatchObject({
      code: 'ADMIN_IP_DENIED',
      request_id: 'req-admin-ip-denied',
    });
    expect(String(res.body.message || '')).toMatch(/ip not allowed/i);
  });

  it('returns 200 when ADMIN_IP_ALLOWLIST allows the client ip', async () => {
    process.env.ADMIN_IP_ALLOWLIST = '127.0.0.1';
    const app = createApp();

    const res = await request(app)
      .get('/admin')
      .set('authorization', 'Bearer test_admin_token')
      .set('x-request-id', 'req-admin-ip-ok')
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('supports optional session login when enabled', async () => {
    process.env.ADMIN_SESSION_AUTH_ENABLED = 'true';
    process.env.ADMIN_SESSION_USER = 'admin';
    process.env.ADMIN_SESSION_PASS = 'pass';
    process.env.ADMIN_SESSION_SECRET = 'secret_for_tests';

    const app = createApp();

    await request(app)
      .post('/admin/login')
      .type('form')
      .send({ username: 'admin', password: 'wrong' })
      .expect(401);

    const loginRes = await request(app)
      .post('/admin/login')
      .type('form')
      .send({ username: 'admin', password: 'pass' })
      .expect(302);

    const cookie = loginRes.headers['set-cookie']?.[0];
    expect(cookie).toBeTruthy();

    const res = await request(app)
      .get('/admin')
      .set('Cookie', cookie)
      .set('x-request-id', 'req-admin-session-ok')
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('does not allow session auth when enabled but secret is missing', async () => {
    process.env.ADMIN_SESSION_AUTH_ENABLED = 'true';
    delete process.env.ADMIN_SESSION_SECRET;
    delete process.env.ADMIN_TOKEN;

    const app = express();
    app.use(requestIdMiddleware);

    // Simulate a forged/mis-set session object.
    app.use((req, _res, next) => {
      (req as any).session = { admin: true };
      next();
    });

    app.get('/admin', adminAuth, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .get('/admin')
      .set('x-request-id', 'req-admin-session-misconfigured')
      .expect(401);

    expect(res.body).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
      request_id: 'req-admin-session-misconfigured',
    });
  });
});
