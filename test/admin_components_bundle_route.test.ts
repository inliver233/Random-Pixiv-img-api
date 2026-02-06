import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import adminRoute from '../src/routes/admin.ts';

describe('AdminJS components bundle route', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevTmpDir = process.env.ADMIN_JS_TMP_DIR;
  const prevAdminToken = process.env.ADMIN_TOKEN;

  let tmpRoot: string | null = null;

  beforeEach(async () => {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_TOKEN = 'test_admin_token';

    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pixivcat-adminjs-'));
    const dotDir = path.join(tmpRoot, '.adminjs');
    await fs.mkdir(dotDir, { recursive: true });
    await fs.writeFile(path.join(dotDir, 'bundle.js'), 'console.log("ok")', 'utf8');

    process.env.ADMIN_JS_TMP_DIR = dotDir;
  });

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = null;
    }

    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;

    if (prevTmpDir === undefined) delete process.env.ADMIN_JS_TMP_DIR;
    else process.env.ADMIN_JS_TMP_DIR = prevTmpDir;

    if (prevAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = prevAdminToken;
  });

  it('serves bundle.js even when tmp dir is a dotfile', async () => {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use('/admin', adminRoute);

    const res = await request(app)
      .get('/admin/frontend/assets/components.bundle.js')
      .set('x-admin-token', 'test_admin_token')
      .expect(200);

    expect(res.text).toContain('console.log');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('falls through outside production mode', async () => {
    process.env.NODE_ENV = 'development';

    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use('/admin', adminRoute);

    await request(app)
      .get('/admin/frontend/assets/components.bundle.js')
      .set('authorization', 'Bearer test_admin_token')
      .expect(404);
  });
});
