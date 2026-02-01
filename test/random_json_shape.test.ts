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

describe('GET /random (json shape)', () => {
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

  it('returns expected fields and types', async () => {
    prisma.image.findFirst.mockResolvedValueOnce({
      id: 1n,
      illustId: 987654321n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'https://example.test/origin.jpg',
    });
    prisma.image.findUnique.mockResolvedValueOnce({
      id: 1n,
      illustId: 987654321n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'https://example.test/origin.jpg',
      xRestrict: 1,
      width: 2480,
      height: 3508,
      orientation: 1,
      userId: 112233n,
      userName: 'someone',
      imageTags: [{ tag: { name: 'tagB' } }, { tag: { name: 'tagA' } }, { tag: { name: 'tagA' } }],
    });

    const app = createApp();

    const res = await request(app)
      .get('/random?format=json')
      .set('x-request-id', 'req-random-json-shape')
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');

    expect(res.body).toMatchObject({
      id: 1,
      illust_id: 987654321,
      page_index: 0,
      r18: true,
      width: 2480,
      height: 3508,
      orientation: 'portrait',
      author: { user_id: 112233, name: 'someone' },
      urls: { proxy: '/i/1.jpg', origin: 'https://example.test/origin.jpg' },
      cache: { max_age: 31536000 },
      debug: { picked_by: 'random_key', attempt: 3 },
    });

    expect(Array.isArray(res.body.tags)).toBe(true);
    expect(res.body.tags).toEqual(['tagA', 'tagB']);

    expect(() => new URL(res.body.urls.proxy, 'https://example.test')).not.toThrow();
  });

  it('sets debug.attempt from attempts param (clamped)', async () => {
    prisma.image.findFirst.mockResolvedValue({
      id: 1n,
      illustId: 987654321n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'https://example.test/origin.jpg',
    });
    prisma.image.findUnique.mockResolvedValue({
      id: 1n,
      illustId: 987654321n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'https://example.test/origin.jpg',
      imageTags: [],
    });

    const app = createApp();

    const res1 = await request(app)
      .get('/random?format=json&attempts=9')
      .set('x-request-id', 'req-random-json-attempts-9')
      .expect(200);
    expect(res1.body.debug.attempt).toBe(9);

    const res2 = await request(app)
      .get('/random?format=json&attempts=11')
      .set('x-request-id', 'req-random-json-attempts-11')
      .expect(200);
    expect(res2.body.debug.attempt).toBe(10);
  });
});

