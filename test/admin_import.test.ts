import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTest } from '../src/config/env';
import { setPrismaClientForTest } from '../src/db/prismaClient';
import * as importJobs from '../src/jobs/importImages';
import * as queue from '../src/queue/queue';
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

describe('POST /admin/images/import', () => {
  const prisma = {
    import: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    prisma.import.create.mockReset();
    prisma.import.update.mockReset();
    prisma.import.findUnique.mockReset();

    delete process.env.ADMIN_IMPORT_MAX_LINES;
    delete process.env.ADMIN_IMPORT_MAX_FILE_BYTES;
    delete process.env.ADMIN_IMPORT_ALLOWED_MIME_TYPES;
    delete process.env.ADMIN_IMPORT_BULK_MIN_IMAGES;
    delete process.env.ADMIN_IMPORT_MAX_HYDRATE_ILLUSTS;
    resetEnvForTest();

    setPrismaClientForTest(prisma);
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    vi.restoreAllMocks();

    delete process.env.ADMIN_IMPORT_MAX_LINES;
    delete process.env.ADMIN_IMPORT_MAX_FILE_BYTES;
    delete process.env.ADMIN_IMPORT_ALLOWED_MIME_TYPES;
    delete process.env.ADMIN_IMPORT_BULK_MIN_IMAGES;
    delete process.env.ADMIN_IMPORT_MAX_HYDRATE_ILLUSTS;
    resetEnvForTest();
  });

  it('enqueues import job and returns import_id', async () => {
    prisma.import.create.mockResolvedValue({ id: 10n, detail: null, total: 1, success: 0, failed: 0 });
    prisma.import.update.mockResolvedValue({ id: 10n });

    vi.spyOn(importJobs, 'enqueueAdminImagesImport').mockResolvedValueOnce('job-1');

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .field('urls', VALID_URL)
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');

    expect(res.body).toMatchObject({
      ok: true,
      import_id: '10',
      total_lines: 1,
      unique_images: 1,
      deduped: 0,
      queued: true,
      job_id: 'job-1',
      success: 0,
      failed: 0,
      enqueued: { hydrate_metadata: 0, note: 'queued' },
    });

    expect(importJobs.enqueueAdminImagesImport).toHaveBeenCalledTimes(1);
    expect(importJobs.enqueueAdminImagesImport).toHaveBeenCalledWith(
      expect.objectContaining({
        importId: 10n,
        items: [
          expect.objectContaining({
            illust_id: '12345678',
            page_index: 0,
            ext: 'jpg',
          }),
        ],
      }),
    );

    expect(prisma.import.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total: 1,
          createdBy: 'admin_token',
          source: 'admin_api',
          success: 0,
          failed: 0,
          detail: expect.objectContaining({
            deduped: 0,
            unique: 1,
          }),
        }),
      }),
    );
  });

  it('GET /admin/imports/:id returns progress details', async () => {
    prisma.import.findUnique.mockResolvedValue({
      id: 99n,
      createdAt: new Date('2020-01-01T00:00:00Z'),
      source: 'admin_api',
      total: 10,
      success: 3,
      failed: 2,
      detail: { foo: 'bar' },
    });

    vi.spyOn(queue, 'getQueueHealth').mockResolvedValue({ ok: true, message: 'disabled' });

    const app = createApp();

    const res = await request(app)
      .get('/admin/imports/99')
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      import: {
        id: '99',
        created_at: '2020-01-01T00:00:00.000Z',
        source: 'admin_api',
        total: 10,
        success: 3,
        failed: 2,
        detail: { foo: 'bar' },
      },
      progress: { total: 10, processed: 5, remaining: 5, done: false },
      queue: { ok: true, message: 'disabled' },
    });
  });

  it('GET /admin/imports/:id returns 404 when missing', async () => {
    prisma.import.findUnique.mockResolvedValue(null);

    const app = createApp();

    const res = await request(app)
      .get('/admin/imports/123')
      .expect(404);

    expect(res.body).toMatchObject({ code: 'IMPORT_NOT_FOUND' });
  });

  it('GET /admin/imports/:id returns 400 on invalid id', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/admin/imports/not-a-number')
      .expect(400);

    expect(res.body).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('imports from file upload', async () => {
    prisma.import.create.mockResolvedValue({ id: 11n, detail: null, total: 1, success: 0, failed: 0 });
    prisma.import.update.mockResolvedValue({ id: 11n });

    vi.spyOn(importJobs, 'enqueueAdminImagesImport').mockResolvedValueOnce('job-file');

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .attach('file', Buffer.from(`${VALID_URL}\n`), { filename: 'urls.txt', contentType: 'text/plain' })
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      import_id: '11',
      total_lines: 1,
      queued: true,
      job_id: 'job-file',
      success: 0,
      failed: 0,
    });
  });

  it('records invalid URLs as errors', async () => {
    prisma.import.create.mockResolvedValue({ id: 12n, detail: null, total: 2, success: 0, failed: 1 });
    prisma.import.update.mockResolvedValue({ id: 12n });

    vi.spyOn(importJobs, 'enqueueAdminImagesImport').mockResolvedValueOnce('job-invalid');

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .field('urls', `${VALID_URL}\nnot-a-url`)
      .expect(200);

    expect(res.body).toMatchObject({
      total_lines: 2,
      unique_images: 1,
      queued: true,
      job_id: 'job-invalid',
      success: 0,
      failed: 1,
    });

    expect(res.body.errors[0]).toMatchObject({
      line: 2,
      url: 'not-a-url',
      code: 'invalid_url',
    });

    expect(res.body.error_export).toMatchObject({
      total_errors: 1,
      exported_errors: 1,
      truncated: false,
    });
    expect(res.body.error_export.urls_text).toBe('not-a-url');
    expect(res.body.error_export.urls_with_comments_text).toContain('not-a-url');
  });

  it('supports dry_run=1 without writing DB', async () => {
    const enqueueSpy = vi.spyOn(importJobs, 'enqueueAdminImagesImport');
    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .field('urls', VALID_URL)
      .field('dry_run', '1')
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      dry_run: true,
      import_id: null,
      total_lines: 1,
      unique_images: 1,
      deduped: 0,
      success: 1,
      failed: 0,
      enqueued: { hydrate_metadata: 0 },
    });

    expect(res.body.results[0]).toMatchObject({
      illust_id: '12345678',
      page_index: 0,
      image_id: null,
      ext: 'jpg',
      original_url: VALID_URL,
      proxy_path: null,
    });

    expect(prisma.import.create).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('supports preview=1 (dedupe + parse) without writing DB', async () => {
    const enqueueSpy = vi.spyOn(importJobs, 'enqueueAdminImagesImport');
    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .field('urls', `${VALID_URL}\n${VALID_URL}`)
      .field('preview', '1')
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      dry_run: true,
      import_id: null,
      total_lines: 2,
      unique_images: 1,
      deduped: 1,
      success: 1,
      failed: 0,
    });

    expect(res.body.preview).toEqual([
      {
        illust_id: '12345678',
        page_index: 0,
        ext: 'jpg',
        original_url: VALID_URL,
      },
    ]);

    expect(prisma.import.create).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('dedupes repeated lines by (illustId,pageIndex)', async () => {
    prisma.import.create.mockResolvedValue({ id: 13n, detail: null, total: 2, success: 0, failed: 0 });
    prisma.import.update.mockResolvedValue({ id: 13n });

    vi.spyOn(importJobs, 'enqueueAdminImagesImport').mockResolvedValueOnce('job-dedupe');

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .field('urls', `${VALID_URL}\n${VALID_URL}`)
      .expect(200);

    expect(res.body).toMatchObject({
      total_lines: 2,
      unique_images: 1,
      deduped: 1,
      queued: true,
      job_id: 'job-dedupe',
      success: 0,
      failed: 0,
    });
  });

  it('returns 413 when uploaded file exceeds the configured limit', async () => {
    process.env.ADMIN_IMPORT_MAX_FILE_BYTES = '10';
    resetEnvForTest();

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .attach('file', Buffer.from(`${VALID_URL}\n${'a'.repeat(200)}\n`), { filename: 'urls.txt', contentType: 'text/plain' })
      .expect(413);

    expect(res.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('returns 400 when total lines exceeds the configured max_lines_limit', async () => {
    process.env.ADMIN_IMPORT_MAX_LINES = '1';
    resetEnvForTest();

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .field('urls', `${VALID_URL}\n${VALID_URL}`)
      .expect(400);

    expect(res.body).toMatchObject({ code: 'MAX_LINES_EXCEEDED' });
  });

  it('returns 400 when upload content-type is not allowed', async () => {
    process.env.ADMIN_IMPORT_ALLOWED_MIME_TYPES = 'text/plain';
    resetEnvForTest();

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .attach('file', Buffer.from('hello'), { filename: 'urls.png', contentType: 'image/png' })
      .expect(400);

    expect(res.body).toMatchObject({ code: 'INVALID_UPLOAD_TYPE' });
  });
});

describe('POST /admin/imports/:id/rollback', () => {
  const prisma = {
    import: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    setPrismaClientForTest(prisma);
    prisma.import.update.mockReset();
    prisma.import.findUnique.mockReset();
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    vi.restoreAllMocks();
  });

  it('enqueues rollback job and returns job_id', async () => {
    prisma.import.findUnique.mockResolvedValueOnce({ id: 99n, detail: { foo: 'bar' } });
    prisma.import.update.mockResolvedValueOnce({ id: 99n });

    vi.spyOn(importJobs, 'enqueueAdminImportRollback').mockResolvedValueOnce('job-rb-1');

    const app = createApp();

    const res = await request(app)
      .post('/admin/imports/99/rollback')
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, import_id: '99', mode: 'disable', job_id: 'job-rb-1' });
    expect(importJobs.enqueueAdminImportRollback).toHaveBeenCalledWith(expect.objectContaining({ importId: 99n, mode: 'disable' }));
    expect(prisma.import.update).toHaveBeenCalledTimes(1);
  });

  it('supports mode=delete via querystring', async () => {
    prisma.import.findUnique.mockResolvedValueOnce({ id: 100n, detail: null });
    prisma.import.update.mockResolvedValueOnce({ id: 100n });

    vi.spyOn(importJobs, 'enqueueAdminImportRollback').mockResolvedValueOnce('job-rb-2');

    const app = createApp();

    const res = await request(app)
      .post('/admin/imports/100/rollback?mode=delete')
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, import_id: '100', mode: 'delete', job_id: 'job-rb-2' });
    expect(importJobs.enqueueAdminImportRollback).toHaveBeenCalledWith(expect.objectContaining({ importId: 100n, mode: 'delete' }));
  });

  it('returns 404 when import is missing', async () => {
    prisma.import.findUnique.mockResolvedValueOnce(null);

    const app = createApp();

    const res = await request(app)
      .post('/admin/imports/123/rollback')
      .expect(404);

    expect(res.body).toMatchObject({ code: 'IMPORT_NOT_FOUND' });
  });
});

describe('POST /admin/images/hydrate', () => {
  beforeEach(() => {
    setPrismaClientForTest({} as any);
    delete process.env.ADMIN_IMPORT_MAX_LINES;
    delete process.env.ADMIN_IMPORT_MAX_FILE_BYTES;
    delete process.env.ADMIN_IMPORT_ALLOWED_MIME_TYPES;
    resetEnvForTest();
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    vi.restoreAllMocks();

    delete process.env.ADMIN_IMPORT_MAX_LINES;
    delete process.env.ADMIN_IMPORT_MAX_FILE_BYTES;
    delete process.env.ADMIN_IMPORT_ALLOWED_MIME_TYPES;
    resetEnvForTest();
  });

  it('enqueues hydrate_metadata once per illust_id', async () => {
    const urlP1 = VALID_URL.replace('_p0.', '_p1.');

    const send = vi.fn().mockResolvedValue('job-1');
    vi.spyOn(queue, 'ensureQueue').mockResolvedValue({ send } as any);

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/hydrate')
      .field('urls', `${VALID_URL}\n${urlP1}`)
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');

    expect(res.body).toMatchObject({
      ok: true,
      hydrate_only: true,
      total_lines: 2,
      unique_illusts: 1,
      failed: 0,
      enqueued: { hydrate_metadata: 1, note: 'ok' },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('hydrate_metadata', expect.objectContaining({ illust_id: '12345678' }));
  });

  it('returns 400 when input is empty', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/admin/images/hydrate')
      .field('urls', '')
      .expect(400);

    expect(res.body).toMatchObject({ code: 'EMPTY_INPUT' });
  });
});
