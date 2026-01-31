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

describe('GET /random (redirect)', () => {
  const prisma = {
    image: {
      findFirst: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    prisma.image.findFirst.mockReset();
    setPrismaClientForTest(prisma);
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
  });

  it('returns 400 for invalid redirect', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/random?redirect=yes')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-redirect-invalid')
      .expect(400);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid redirect.',
      request_id: 'req-random-redirect-invalid',
    });
  });

  it('returns 302 to a stable proxy URL when redirect=1', async () => {
    prisma.image.findFirst.mockResolvedValueOnce({
      id: 10n,
      illustId: 20n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'https://example.test/original.jpg',
    });

    const app = createApp();

    const res = await request(app)
      .get('/random?redirect=1')
      .set('x-request-id', 'req-random-redirect-1')
      .expect(302);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.location).toBe('/i/10.jpg');
  });

  it('accepts redirect=0 (does not redirect)', async () => {
    prisma.image.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const app = createApp();

    const res = await request(app)
      .get('/random?redirect=0')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-redirect-0')
      .expect(404);

    expect(res.headers.location).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.code).toBe('NO_MATCH');
  });

  it('redirect=1 takes precedence over format=json', async () => {
    prisma.image.findFirst.mockResolvedValueOnce({
      id: 11n,
      illustId: 21n,
      pageIndex: 0,
      ext: 'png',
      originalUrl: 'https://example.test/original.png',
    });

    const app = createApp();

    const res = await request(app)
      .get('/random?redirect=1&format=json')
      .set('x-request-id', 'req-random-redirect-1-format-json')
      .expect(302);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.location).toBe('/i/11.png');
  });
});
