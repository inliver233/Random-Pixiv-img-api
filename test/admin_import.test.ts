import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTest } from '../src/config/env';
import { setPrismaClientForTest } from '../src/db/prismaClient';
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
    image: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    import: {
      create: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    prisma.image.upsert.mockReset();
    prisma.image.update.mockReset();
    prisma.import.create.mockReset();

    delete process.env.ADMIN_IMPORT_MAX_LINES;
    delete process.env.ADMIN_IMPORT_MAX_FILE_BYTES;
    delete process.env.ADMIN_IMPORT_ALLOWED_MIME_TYPES;
    resetEnvForTest();

    setPrismaClientForTest(prisma);
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    vi.restoreAllMocks();

    delete process.env.ADMIN_IMPORT_MAX_LINES;
    delete process.env.ADMIN_IMPORT_MAX_FILE_BYTES;
    delete process.env.ADMIN_IMPORT_ALLOWED_MIME_TYPES;
    resetEnvForTest();
  });

  it('imports from textarea and writes audit', async () => {
    prisma.image.upsert.mockResolvedValue({ id: 1n, ext: 'jpg', proxyPath: '/i/pending.jpg' });
    prisma.image.update.mockResolvedValue({ id: 1n, proxyPath: '/i/1.jpg' });
    prisma.import.create.mockResolvedValue({ id: 10n });

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
      success: 1,
      failed: 0,
      enqueued: { hydrate_metadata: 0 },
    });

    expect(res.body.results[0]).toMatchObject({
      illust_id: '12345678',
      page_index: 0,
      image_id: '1',
      ext: 'jpg',
      original_url: VALID_URL,
      proxy_path: '/i/1.jpg',
    });

    expect(prisma.image.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.image.update).toHaveBeenCalledWith({ where: { id: 1n }, data: { proxyPath: '/i/1.jpg' } });

    expect(prisma.import.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total: 1,
          source: 'admin_api',
          success: 1,
          failed: 0,
          detail: expect.objectContaining({
            deduped: 0,
            unique: 1,
          }),
        }),
      }),
    );
  });

  it('imports from file upload', async () => {
    prisma.image.upsert.mockResolvedValue({ id: 2n, ext: 'jpg', proxyPath: '/i/pending.jpg' });
    prisma.image.update.mockResolvedValue({ id: 2n, proxyPath: '/i/2.jpg' });
    prisma.import.create.mockResolvedValue({ id: 11n });

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .attach('file', Buffer.from(`${VALID_URL}\n`), { filename: 'urls.txt', contentType: 'text/plain' })
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      import_id: '11',
      total_lines: 1,
      success: 1,
      failed: 0,
    });

    expect(res.body.results[0]).toMatchObject({
      image_id: '2',
      proxy_path: '/i/2.jpg',
    });
  });

  it('records invalid URLs as errors', async () => {
    prisma.image.upsert.mockResolvedValue({ id: 1n, ext: 'jpg', proxyPath: '/i/pending.jpg' });
    prisma.image.update.mockResolvedValue({ id: 1n, proxyPath: '/i/1.jpg' });
    prisma.import.create.mockResolvedValue({ id: 12n });

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .field('urls', `${VALID_URL}\nnot-a-url`)
      .expect(200);

    expect(res.body).toMatchObject({
      total_lines: 2,
      unique_images: 1,
      success: 1,
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

    expect(prisma.image.upsert).not.toHaveBeenCalled();
    expect(prisma.image.update).not.toHaveBeenCalled();
    expect(prisma.import.create).not.toHaveBeenCalled();
  });

  it('supports preview=1 (dedupe + parse) without writing DB', async () => {
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

    expect(prisma.image.upsert).not.toHaveBeenCalled();
    expect(prisma.image.update).not.toHaveBeenCalled();
    expect(prisma.import.create).not.toHaveBeenCalled();
  });

  it('dedupes repeated lines by (illustId,pageIndex)', async () => {
    prisma.image.upsert.mockResolvedValue({ id: 3n, ext: 'jpg', proxyPath: '/i/pending.jpg' });
    prisma.image.update.mockResolvedValue({ id: 3n, proxyPath: '/i/3.jpg' });
    prisma.import.create.mockResolvedValue({ id: 13n });

    const app = createApp();

    const res = await request(app)
      .post('/admin/images/import')
      .field('urls', `${VALID_URL}\n${VALID_URL}`)
      .expect(200);

    expect(res.body).toMatchObject({
      total_lines: 2,
      unique_images: 1,
      deduped: 1,
      success: 1,
      failed: 0,
    });

    expect(prisma.image.upsert).toHaveBeenCalledTimes(1);
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
