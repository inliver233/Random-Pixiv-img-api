import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import adminRoute from '../src/routes/admin.ts';

const require = createRequire(import.meta.url);

const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');

function createApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.use('/admin', adminRoute);
  return app;
}

describe('Admin auth (/admin)', () => {
  const prevAdminToken = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = 'test_admin_token';
  });

  afterEach(() => {
    if (prevAdminToken === undefined) {
      delete process.env.ADMIN_TOKEN;
    } else {
      process.env.ADMIN_TOKEN = prevAdminToken;
    }
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
});

