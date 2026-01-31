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

describe('GET /random (filter r18)', () => {
  beforeEach(() => {
    vi.resetModules();
    pickRandomImageRecord.mockReset();
    pickRandomImageStream.mockReset();
    pickRandomImageStream.mockResolvedValue(null);
  });

  it('defaults r18 to 0 (xRestrict=0)', async () => {
    const app = await createApp();

    await request(app)
      .get('/random')
      .set('accept', 'application/json')
      .expect(404);

    expect(pickRandomImageStream).toHaveBeenCalled();
    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0 });
  });

  it('maps r18=1 to xRestrict=1', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?r18=1')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 1 });
  });

  it('treats r18=any as no xRestrict filter', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?r18=any')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({});
  });

  it('combines r18 and orientation filters', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?r18=1&orientation=portrait')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 1, orientation: 1 });
  });

  it('returns 400 for invalid r18', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?r18=3')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-r18-invalid')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid r18.',
      request_id: 'req-random-r18-invalid',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('returns 400 for empty r18 value', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?r18=')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-r18-empty')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid r18.',
      request_id: 'req-random-r18-empty',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });
});
