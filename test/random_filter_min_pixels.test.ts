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

describe('GET /random (filter min_pixels)', () => {
  beforeEach(() => {
    vi.resetModules();
    pickRandomImageRecord.mockReset();
    pickRandomImageStream.mockReset();
    pickRandomImageStream.mockResolvedValue(null);
  });

  it('maps min_pixels to filters.minPixels', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?min_pixels=1000000')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, minPixels: 1000000 });
  });

  it('returns 400 for invalid min_pixels', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?min_pixels=-1')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-min-pixels-invalid')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid min_pixels.',
      request_id: 'req-random-min-pixels-invalid',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('returns 400 for min_pixels above int4 max', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?min_pixels=2147483648')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-min-pixels-int4-over')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid min_pixels.',
      request_id: 'req-random-min-pixels-int4-over',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('accepts min_pixels=0', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?min_pixels=0')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, minPixels: 0 });
  });

  it('accepts min_pixels=int4 max', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?min_pixels=2147483647')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, minPixels: 2147483647 });
  });

  it('returns 400 for empty min_pixels', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?min_pixels=')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-min-pixels-empty')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid min_pixels.',
      request_id: 'req-random-min-pixels-empty',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('combines min_pixels with r18 and orientation', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?r18=1&orientation=portrait&min_pixels=123')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 1, orientation: 1, minPixels: 123 });
  });
});
