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

describe('GET /random (filter orientation)', () => {
  beforeEach(() => {
    vi.resetModules();
    pickRandomImageRecord.mockReset();
    pickRandomImageStream.mockReset();
    pickRandomImageStream.mockResolvedValue(null);
  });

  it('defaults orientation to any (no orientation filter)', async () => {
    const app = await createApp();

    await request(app)
      .get('/random')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0 });
  });

  it('maps orientation=portrait to orientation=1', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?orientation=portrait')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, orientation: 1 });
  });

  it('maps orientation=landscape to orientation=2', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?orientation=landscape')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, orientation: 2 });
  });

  it('maps orientation=square to orientation=3', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?orientation=square')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, orientation: 3 });
  });

  it('treats orientation=any as no orientation filter', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?orientation=any')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0 });
  });

  it('returns 400 for invalid orientation', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?orientation=diagonal')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-orientation-invalid')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid orientation.',
      request_id: 'req-random-orientation-invalid',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('returns 400 for empty orientation value', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?orientation=')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-orientation-empty')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid orientation.',
      request_id: 'req-random-orientation-empty',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });
});

