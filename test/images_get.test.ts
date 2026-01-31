import express from 'express';
import path from 'node:path';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import imagesRoute from '../src/routes/images.ts';

const require = createRequire(import.meta.url);

const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');
const errorHandler = require('../src/middlewares/errorHandler.js');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'views'));

  app.use(requestIdMiddleware);
  app.use('/images', imagesRoute);
  app.use(errorHandler);

  return app;
}

describe('GET /images/:id', () => {
  const prisma = {
    image: {
      findUnique: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    prisma.image.findUnique.mockReset();
    setPrismaClientForTest(prisma);
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
  });

  it('returns 400 for invalid id', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/images/not-a-number')
      .set('x-request-id', 'req-images-400')
      .expect(400);

    expect(res.body).toEqual({
      code: 'INVALID_ID',
      message: 'Invalid id.',
      request_id: 'req-images-400',
    });
  });

  it('returns 404 when record does not exist', async () => {
    prisma.image.findUnique.mockResolvedValueOnce(null);

    const app = createApp();

    const res = await request(app).get('/images/1').set('x-request-id', 'req-images-404');

    if (res.status !== 404) {
      // eslint-disable-next-line no-console
      console.log('unexpected /images/1 response', res.status, res.headers['content-type'], res.body, res.text);
    }

    expect(res.status).toBe(404);

    expect(res.body).toEqual({
      code: 'NOT_FOUND',
      message: 'Not Found',
      request_id: 'req-images-404',
    });

    expect(prisma.image.findUnique).toHaveBeenCalledWith({
      where: { id: 1n },
      include: {
        imageTags: {
          include: {
            tag: true,
          },
        },
      },
    });
  });

  it('returns 200 with normalized JSON record when found', async () => {
    prisma.image.findUnique.mockResolvedValueOnce({
      id: 10n,
      illustId: 12345678n,
      pageIndex: 0,
      ext: 'jpg',
      width: 800,
      height: 600,
      xRestrict: 0,
      userId: 999n,
      userName: 'author',
      status: 1,
      imageTags: [{ tag: { name: 'tag1' } }, { tag: { name: 'tag2' } }],
      failCount: 2,
      lastFailAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const app = createApp();

    const res = await request(app).get('/images/10').set('x-request-id', 'req-images-200');

    if (res.status !== 200) {
      // eslint-disable-next-line no-console
      console.log('unexpected /images/10 response', res.status, res.headers['content-type'], res.body, res.text);
    }

    expect(res.status).toBe(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      id: 10,
      illust_id: 12345678,
      page_index: 0,
      ext: 'jpg',
      width: 800,
      height: 600,
      x_restrict: 0,
      user_id: 999,
      user_name: 'author',
      status: 'active',
      tags: ['tag1', 'tag2'],
      fail_count: 2,
      last_fail_at: '2026-02-01T00:00:00.000Z',
    });
  });
});
