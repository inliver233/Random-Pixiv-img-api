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

describe('GET /random (attempts)', () => {
  beforeEach(() => {
    vi.resetModules();
    pickRandomImageRecord.mockReset();
    pickRandomImageStream.mockReset();
  });

  it('defaults attempts to 3', async () => {
    pickRandomImageStream.mockResolvedValueOnce(null);

    const app = await createApp();

    await request(app)
      .get('/random')
      .set('accept', 'application/json')
      .expect(404);

    const call = pickRandomImageStream.mock.calls[0];
    expect(call?.[1]).toBe(3);
  });

  it('passes attempts and clamps to 1..10', async () => {
    pickRandomImageStream.mockResolvedValue(null);

    const app = await createApp();

    await request(app)
      .get('/random?attempts=0')
      .set('accept', 'application/json')
      .expect(404);
    expect(pickRandomImageStream.mock.calls.at(-1)?.[1]).toBe(1);

    await request(app)
      .get('/random?attempts=11')
      .set('accept', 'application/json')
      .expect(404);
    expect(pickRandomImageStream.mock.calls.at(-1)?.[1]).toBe(10);

    await request(app)
      .get('/random?attempts=9')
      .set('accept', 'application/json')
      .expect(404);
    expect(pickRandomImageStream.mock.calls.at(-1)?.[1]).toBe(9);
  });

  it('returns 400 for invalid attempts input', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?attempts=abc')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-attempts-invalid')
      .expect(400);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid attempts.',
      request_id: 'req-random-attempts-invalid',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });
});

