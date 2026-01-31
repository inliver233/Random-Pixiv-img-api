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

describe('GET /random (filter user_id)', () => {
  beforeEach(() => {
    vi.resetModules();
    pickRandomImageRecord.mockReset();
    pickRandomImageStream.mockReset();
    pickRandomImageStream.mockResolvedValue(null);
  });

  it('maps user_id to filters.userId', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?user_id=123')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, userId: 123n });
  });

  it('returns 400 for invalid user_id', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?user_id=abc')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-user-id-invalid')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid user_id.',
      request_id: 'req-random-user-id-invalid',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('returns 400 for user_id=0', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?user_id=0')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-user-id-zero')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid user_id.',
      request_id: 'req-random-user-id-zero',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('returns 400 for empty user_id', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?user_id=')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-user-id-empty')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid user_id.',
      request_id: 'req-random-user-id-empty',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });

  it('combines user_id with r18 and orientation', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?r18=1&orientation=portrait&user_id=123')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 1, orientation: 1, userId: 123n });
  });
});

