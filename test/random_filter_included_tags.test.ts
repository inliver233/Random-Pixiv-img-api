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

describe('GET /random (filter included_tags)', () => {
  beforeEach(() => {
    vi.resetModules();
    pickRandomImageRecord.mockReset();
    pickRandomImageStream.mockReset();
    pickRandomImageStream.mockResolvedValue(null);
  });

  it('parses included_tags as a | separated list (AND semantics)', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?included_tags=tag1|tag2')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, includedTags: ['tag1', 'tag2'] });
  });

  it('parses included_tags from repeated query params', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?included_tags=tag1&included_tags=tag2')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, includedTags: ['tag1', 'tag2'] });
  });

  it('parses included_tags as a comma separated list', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?included_tags=tag1,tag2')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, includedTags: ['tag1', 'tag2'] });
  });

  it('deduplicates and trims included_tags', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?included_tags=%20tag1%20|tag1|%20tag2%20')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 0, includedTags: ['tag1', 'tag2'] });
  });

  it('combines included_tags with r18 and orientation', async () => {
    const app = await createApp();

    await request(app)
      .get('/random?r18=1&orientation=portrait&included_tags=tag1|tag2')
      .set('accept', 'application/json')
      .expect(404);

    const filters = pickRandomImageStream.mock.calls[0]?.[0];
    expect(filters).toEqual({ xRestrict: 1, orientation: 1, includedTags: ['tag1', 'tag2'] });
  });

  it('returns 400 for empty included_tags', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/random?included_tags=')
      .set('accept', 'application/json')
      .set('x-request-id', 'req-random-included-tags-empty')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid included_tags.',
      request_id: 'req-random-included-tags-empty',
    });
    expect(pickRandomImageStream).not.toHaveBeenCalled();
  });
});
