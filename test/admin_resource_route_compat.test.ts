import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import adminRoute from '../src/routes/admin.ts';
import { adminAuditResourceOptions } from '../src/admin/resources/adminAudits';
import { importResourceOptions } from '../src/admin/resources/imports';
import { proxyPoolResourceOptions } from '../src/admin/resources/proxyPools';
import { requestLogResourceOptions } from '../src/admin/resources/requestLogs';

const require = createRequire(import.meta.url);
const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(requestIdMiddleware);
  app.use('/admin', adminRoute);
  return app;
}

describe('admin resource route compatibility', () => {
  const prevToken = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = 'test_admin_token';
  });

  afterEach(() => {
    if (prevToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = prevToken;
  });

  it('redirects /resources/:id/new to /resources/:id/actions/new', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/admin/resources/Import/new?from=compat')
      .set('x-admin-token', 'test_admin_token')
      .expect(302);

    expect(res.headers.location).toBe('/admin/resources/Import/actions/new?from=compat');
  });

  it('declares read-only resources as inaccessible for write actions', () => {
    const readonlyResources = [
      importResourceOptions,
      requestLogResourceOptions,
      adminAuditResourceOptions,
      proxyPoolResourceOptions,
    ] as any[];

    for (const options of readonlyResources) {
      expect(options.actions.new.isAccessible).toBe(false);
      expect(options.actions.edit.isAccessible).toBe(false);
      expect(options.actions.delete.isAccessible).toBe(false);
      expect(options.actions.bulkDelete.isAccessible).toBe(false);
    }
  });
});
