import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTest } from '../src/config/env';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const errorHandler = require('../src/middlewares/errorHandler.js');

function resetEnvCaches() {
  resetEnvForTest();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const envJs = require('../src/config/env.js') as typeof import('../src/config/env.js');
  envJs.resetEnvForTest();
}

function createApp() {
  // Lazy import to ensure env changes apply after resetEnvForTest().
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getEnv } = require('../src/config/env.js') as typeof import('../src/config/env.js');

  const env = getEnv();
  const app = express();

  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));

  app.post('/admin/echo', (req, res) => {
    res.status(200).json({ ok: true, body: req.body });
  });

  app.use(errorHandler);
  return app;
}

describe('request body limits', () => {
  beforeEach(() => {
    delete process.env.JSON_BODY_LIMIT;
    resetEnvCaches();
  });

  afterEach(() => {
    delete process.env.JSON_BODY_LIMIT;
    resetEnvCaches();
  });

  it('returns 413 when JSON payload exceeds limit', async () => {
    process.env.JSON_BODY_LIMIT = '10b';
    resetEnvCaches();

    const app = createApp();

    const res = await request(app)
      .post('/admin/echo')
      .set('content-type', 'application/json')
      .send({ a: 'x'.repeat(200) })
      .expect(413);

    expect(res.body).toMatchObject({ code: 'ERROR' });
  });

  it('returns 400 for invalid JSON', async () => {
    process.env.JSON_BODY_LIMIT = '1kb';
    resetEnvCaches();

    const app = createApp();

    const res = await request(app)
      .post('/admin/echo')
      .set('content-type', 'application/json')
      .send('{"invalid_json":')
      .expect(400);

    expect(res.body).toMatchObject({ code: 'BAD_REQUEST' });
  });
});
