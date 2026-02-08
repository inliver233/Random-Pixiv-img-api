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

describe('GET /random (filter min_width)', () => {
  beforeEach(() => {
    vi.resetModules();
    pickRandomImageRecord.mockReset();
    pickRandomImageStream.mockReset();
    pickRandomImageStream.mockResolvedValue(null);
  });

  it('maps min_width to filters.minWidth', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?min_width=640')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, minWidth: 640 });
  });

  it('returns 400 for invalid min_width', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?min_width=-1')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-min-width-invalid')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid min_width.',
      request_id: 'req-random-min-width-invalid',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('returns 400 for min_width above int4 max', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?min_width=2147483648')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-min-width-int4-over')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid min_width.',
      request_id: 'req-random-min-width-int4-over',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('accepts min_width=0', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?min_width=0')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, minWidth: 0 });
  });

  it('accepts min_width=int4 max', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?min_width=2147483647')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, minWidth: 2147483647 });
  });

  it('returns 400 for empty min_width', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?min_width=')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-min-width-empty')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid min_width.',
      request_id: 'req-random-min-width-empty',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('combines min_width with r18 and orientation', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?r18=1&orientation=portrait&min_width=100')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 1, orientation: 1, minWidth: 100 });
  });
});
