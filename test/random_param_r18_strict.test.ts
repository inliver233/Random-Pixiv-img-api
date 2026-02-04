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

describe('GET /random (r18_strict)', () => {
  beforeEach(() => {
    vi.resetModules();
    pickRandomImageRecord.mockReset();
    pickRandomImageStream.mockReset();
    pickRandomImageStream.mockResolvedValue(null);
    delete process.env.RANDOM_R18_STRICT;
  });

  it('sets xRestrictAllowUnknown=false when r18_strict=1 and r18=0', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?r18_strict=1')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, xRestrictAllowUnknown: false });
  });

  it('does not set xRestrictAllowUnknown when r18_strict=0', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?r18_strict=0')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0 });
  });

  it('does not affect r18=1', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?r18=1&r18_strict=1')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 1 });
  });

  it('returns 400 for empty r18_strict value', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?r18_strict=')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-r18-strict-empty')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid r18_strict.',
      request_id: 'req-random-r18-strict-empty',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });
});

