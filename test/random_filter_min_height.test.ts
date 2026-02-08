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

describe('GET /random (filter min_height)', () => {
  beforeEach(() => {
    vi.resetModules();
    pickRandomImageRecord.mockReset();
    pickRandomImageStream.mockReset();
    pickRandomImageStream.mockResolvedValue(null);
  });

  it('maps min_height to filters.minHeight', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?min_height=480')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, minHeight: 480 });
  });

  it('returns 400 for invalid min_height', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?min_height=-1')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-min-height-invalid')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid min_height.',
      request_id: 'req-random-min-height-invalid',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('returns 400 for min_height above int4 max', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?min_height=2147483648')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-min-height-int4-over')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid min_height.',
      request_id: 'req-random-min-height-int4-over',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('accepts min_height=0', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?min_height=0')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, minHeight: 0 });
  });

  it('accepts min_height=int4 max', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?min_height=2147483647')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, minHeight: 2147483647 });
  });

  it('returns 400 for empty min_height', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?min_height=')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-min-height-empty')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid min_height.',
      request_id: 'req-random-min-height-empty',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('combines min_height with r18 and orientation', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?r18=2&orientation=landscape&min_height=200')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 2, orientation: 2, minHeight: 200 });
  });
});
