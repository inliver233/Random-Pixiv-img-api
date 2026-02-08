import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import randomRoute from '../src/routes/random.ts';

const mockPickRandomImageRecord = vi.hoisted(() => vi.fn());
const mockPickRandomImageStream = vi.hoisted(() => vi.fn());

vi.mock('../src/services/randomService', () => ({
  pickRandomImageRecord: mockPickRandomImageRecord,
  pickRandomImageStream: mockPickRandomImageStream,
}));

const require = createRequire(import.meta.url);
const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');
const errorHandler = require('../src/middlewares/errorHandler.js');

function createApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.use('/random', randomRoute);
  app.use(errorHandler);
  return app;
}

describe('random NO_MATCH degrade hints', () => {
  beforeEach(() => {
    mockPickRandomImageRecord.mockReset();
    mockPickRandomImageStream.mockReset();
  });

  it('returns applied filter summary and suggestions when no match', async () => {
    mockPickRandomImageRecord.mockResolvedValueOnce(null);
    const app = createApp();

    const res = await request(app)
      .get('/random?format=json&orientation=portrait&included_tags=cat&user_id=123&r18=1')
      .set('x-request-id', 'req-random-hints')
      .expect(404);

    expect(res.body.code).toBe('NO_MATCH');
    expect(res.body.request_id).toBe('req-random-hints');
    expect(res.body.hints).toMatchObject({
      applied_filters: {
        orientation: 1,
        includedTags: ['cat'],
        userId: '123',
        xRestrict: 1,
      },
    });
    expect(res.body.hints.suggestions).toContain('run hydration backfill to improve metadata coverage');
    expect(res.body.hints.suggestions).toContain('remove orientation filter');
    expect(res.body.hints.suggestions).toContain('relax included_tags');
    expect(res.body.hints.suggestions).toContain('remove user_id/illust_id');
    expect(res.body.hints.suggestions).toContain('fallback to r18=0');
  });
});
