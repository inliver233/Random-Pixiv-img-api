import express from 'express';
import path from 'node:path';
import { createRequire } from 'node:module';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');
const errorHandler = require('../src/middlewares/errorHandler.js');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'views'));

  app.use(requestIdMiddleware);

  app.get('/legacy', () => {
    throw new Error('boom');
  });

  app.get('/random', () => {
    const err = new Error('invalid params') as any;
    err.statusCode = 400;
    err.code = 'INVALID_PARAMS';
    throw err;
  });

  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('renders legacy HTML error page (even with format=json)', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/legacy?format=json')
      .set('x-request-id', 'req-legacy')
      .expect(500);

    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('500 Internal Server Error');
    expect(res.text).toContain('Internal Server Error');
    expect(res.text).toContain('Request ID: req-legacy');
    expect(res.text).not.toContain('boom');
  });

  it('returns JSON error for /random?format=json', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/random?format=json')
      .set('x-request-id', 'req-api')
      .expect(400);

    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toEqual({
      code: 'INVALID_PARAMS',
      message: 'invalid params',
      request_id: 'req-api',
    });
    expect(res.body.stack).toBeUndefined();
  });
});

