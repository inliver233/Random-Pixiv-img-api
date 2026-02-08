import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import imagesRoute from '../src/routes/images.ts';

const require = createRequire(import.meta.url);

const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');
const errorHandler = require('../src/middlewares/errorHandler.js');

function createApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.use('/images', imagesRoute);
  app.use(errorHandler);
  return app;
}

describe('GET /images (int4 overflow guards)', () => {
  it('returns 400 for min_width above int4 max', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/images?limit=1&min_width=2147483648')
      .set('x-request-id', 'req-images-min-width-int4-over')
      .expect(400);

    expect(res.body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid min_width.',
      request_id: 'req-images-min-width-int4-over',
    });
  });
});

