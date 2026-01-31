import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');
const errorHandler = require('../src/middlewares/errorHandler.js');

const pickRandomImageRecord = vi.fn();
const pickRandomImageStream = vi.fn();

vi.mock('../src/services/randomService', () => ({
  pickRandomImageRecord,
  pickRandomImageStream,
}));

async function createApp() {
  const { default: randomRoute } = await import('../src/routes/random.ts');

  const app = express();
  app.use(requestIdMiddleware);
  app.use('/random', randomRoute);
  app.use(errorHandler);
  return app;
}

describe('GET /random (seed)', () => {
  beforeEach(() => {
    vi.resetModules();
    pickRandomImageRecord.mockReset();
    pickRandomImageStream.mockReset();
  });

  it('returns 400 for empty seed', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?format=json&seed=')
      .set('x-request-id', 'req-random-seed-empty')
      .expect(400);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid seed.',
      request_id: 'req-random-seed-empty',
    });
    expect(pickRandomImageRecord).not.toHaveBeenCalled();
  });

  it('is deterministic for the same seed (format=json)', async () => {
    pickRandomImageRecord.mockImplementation(async (_filters: any, random: () => number) => {
      const r = random();
      const id = BigInt(Math.floor(r * 1000000) + 1);
      return {
        id,
        illustId: 2n,
        pageIndex: 0,
        ext: 'jpg',
        originalUrl: 'https://example.test/original.jpg',
      };
    });

    const app = await createApp();

    const res1 = await request(app)
      .get('/random?format=json&seed=hello')
      .expect(200);
    const res2 = await request(app)
      .get('/random?format=json&seed=hello')
      .expect(200);

    expect(res1.headers['cache-control']).toBe('no-store');
    expect(res2.headers['cache-control']).toBe('no-store');
    expect(res1.body.image.id).toBe(res2.body.image.id);
  });

  it('treats seed as trimmed', async () => {
    pickRandomImageRecord.mockImplementation(async (_filters: any, random: () => number) => {
      const r = random();
      const id = BigInt(Math.floor(r * 1000000) + 1);
      return {
        id,
        illustId: 2n,
        pageIndex: 0,
        ext: 'jpg',
        originalUrl: 'https://example.test/original.jpg',
      };
    });

    const app = await createApp();

    const res1 = await request(app)
      .get('/random?format=json&seed=hello')
      .expect(200);
    const res2 = await request(app)
      .get('/random?format=json&seed=%20hello%20')
      .expect(200);

    expect(res1.body.image.id).toBe(res2.body.image.id);
  });
});

