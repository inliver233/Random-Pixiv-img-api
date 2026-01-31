import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import randomRoute from '../src/routes/random.ts';

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

describe('GET /random (empty)', () => {
  const prisma = {
    image: {
      findFirst: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    prisma.image.findFirst.mockReset();
    setPrismaClientForTest(prisma);
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
  });

  it('returns friendly JSON error when no match', async () => {
    prisma.image.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const app = createApp();

    const res = await request(app).get('/random?format=json').set('x-request-id', 'req-random-empty').expect(404);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      code: 'NO_MATCH',
      message: 'No matching image.',
      request_id: 'req-random-empty',
    });
  });
});

