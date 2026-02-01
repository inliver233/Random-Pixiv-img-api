import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import randomRoute from '../src/routes/random.ts';

const require = createRequire(import.meta.url);

const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');
const errorHandler = require('../src/middlewares/errorHandler.js');

function createApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use('/random', randomRoute);
  app.use(errorHandler);

  return app;
}

describe('GET /random (format)', () => {
  const prisma = {
    image: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    prisma.image.findFirst.mockReset();
    prisma.image.findUnique.mockReset();
    setPrismaClientForTest(prisma);
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
  });

  it('returns 400 for invalid format', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/random?format=xml')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-format-invalid')
      .expect(400);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid format.',
      request_id: 'req-random-format-invalid',
    });
  });

  it('accepts format=image', async () => {
    prisma.image.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const app = createApp();

    const res = await request(app)
      .get('/random?format=image')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-format-image')
      .expect(404);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      code: 'NO_MATCH',
      message: 'No matching image.',
      request_id: 'req-random-format-image',
    });
  });

  it('returns JSON payload for format=json', async () => {
    prisma.image.findFirst.mockResolvedValueOnce({
      id: 1n,
      illustId: 2n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'https://example.test/original.jpg',
    });
    prisma.image.findUnique.mockResolvedValueOnce({
      id: 1n,
      illustId: 2n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'https://example.test/original.jpg',
      imageTags: [],
    });

    const app = createApp();

    const res = await request(app)
      .get('/random?format=json')
      .set('x-request-id', 'req-random-format-json')
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      id: 1,
      illust_id: 2,
      page_index: 0,
      r18: false,
      width: null,
      height: null,
      orientation: 'unknown',
      tags: [],
      author: { user_id: null, name: null },
      urls: { proxy: '/i/1.jpg', origin: 'https://example.test/original.jpg' },
      cache: { max_age: 31536000 },
      debug: { picked_by: 'random_key', attempt: 3 },
    });
  });

  it('treats format as case-insensitive and trims whitespace', async () => {
    prisma.image.findFirst.mockResolvedValueOnce({
      id: 3n,
      illustId: 4n,
      pageIndex: 0,
      ext: 'png',
      originalUrl: 'https://example.test/original.png',
    });
    prisma.image.findUnique.mockResolvedValueOnce({
      id: 3n,
      illustId: 4n,
      pageIndex: 0,
      ext: 'png',
      originalUrl: 'https://example.test/original.png',
      imageTags: [],
    });

    const app = createApp();

    const res = await request(app)
      .get('/random?format=%20JSON%20')
      .set('x-request-id', 'req-random-format-json-trim')
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.urls.proxy).toBe('/i/3.png');
    expect(res.body.urls.origin).toBe('https://example.test/original.png');
  });
});
