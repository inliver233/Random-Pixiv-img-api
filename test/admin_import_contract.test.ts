import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import * as importJobs from '../src/jobs/importImages';
import adminImportRoute from '../src/routes/adminImport';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const errorHandler = require('../src/middlewares/errorHandler.js');

function createApp() {
  const app = express();
  app.use('/admin', adminImportRoute);
  app.use(errorHandler);
  return app;
}

const VALID_URL = 'https://i.pximg.net/img-original/img/2020/01/01/00/00/00/12345678_p0.jpg';

describe('admin import contract: accepted vs success', () => {
  const prisma = {
    import: {
      create: vi.fn(),
      update: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = 'test-admin-token';
    setPrismaClientForTest(prisma);
    prisma.import.create.mockReset();
    prisma.import.update.mockReset();
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    delete process.env.ADMIN_TOKEN;
    vi.restoreAllMocks();
  });

  it('returns accepted>0 while success stays 0 for queued imports', async () => {
    prisma.import.create.mockResolvedValue({ id: 1n, detail: null, total: 1, success: 0, failed: 0 });
    prisma.import.update.mockResolvedValue({ id: 1n });
    vi.spyOn(importJobs, 'enqueueAdminImagesImport').mockResolvedValueOnce('job-1');

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .field('urls', VALID_URL)
      .set('authorization', 'Bearer test-admin-token')
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      dry_run: false,
      queued: true,
      accepted: 1,
      success: 0,
      failed: 0,
    });
  });

  it('returns accepted==success for dry_run imports', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .field('urls', VALID_URL)
      .field('dry_run', '1')
      .set('authorization', 'Bearer test-admin-token')
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      dry_run: true,
      import_id: null,
      accepted: 1,
      success: 1,
      failed: 0,
    });
  });
});

