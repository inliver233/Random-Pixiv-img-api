import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

function resetCommonJsModules() {
  const routePath = require.resolve('../src/routes/metrics.js');
  delete require.cache[routePath];

  const envPath = require.resolve('../src/config/env.js');
  delete require.cache[envPath];
}

function createApp() {
  const app = express();
  const metricsRoute = require('../src/routes/metrics.js');

  app.use('/metrics', metricsRoute);
  return app;
}

describe('GET /metrics', () => {
  const originalMetricsEnabled = process.env.METRICS_ENABLED;
  const originalMetricsUser = process.env.METRICS_BASIC_AUTH_USER;
  const originalMetricsPass = process.env.METRICS_BASIC_AUTH_PASS;

  beforeEach(() => {
    process.env.METRICS_ENABLED = 'true';
    delete process.env.METRICS_BASIC_AUTH_USER;
    delete process.env.METRICS_BASIC_AUTH_PASS;
    resetCommonJsModules();
  });

  afterEach(() => {
    if (originalMetricsEnabled === undefined) delete process.env.METRICS_ENABLED;
    else process.env.METRICS_ENABLED = originalMetricsEnabled;

    if (originalMetricsUser === undefined) delete process.env.METRICS_BASIC_AUTH_USER;
    else process.env.METRICS_BASIC_AUTH_USER = originalMetricsUser;

    if (originalMetricsPass === undefined) delete process.env.METRICS_BASIC_AUTH_PASS;
    else process.env.METRICS_BASIC_AUTH_PASS = originalMetricsPass;

    resetCommonJsModules();
  });

  it('returns 200 and includes pixivcat_up metric', async () => {
    const app = createApp();

    const res = await request(app).get('/metrics').expect(200);

    expect(res.headers['content-type']).toMatch(/^text\/plain\b/i);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('pixivcat_up');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('request_duration_seconds');
    expect(res.text).toContain('random_success_total');
    expect(res.text).toContain('random_fail_total');
    expect(res.text).toContain('random_attempts_histogram');
    expect(res.text).toContain('upstream_errors_total');
    expect(res.text).toContain('db_query_duration_seconds');
    expect(res.text).toContain('job_success_total');
    expect(res.text).toContain('job_fail_total');
    expect(res.text).toContain('job_duration_seconds');
    expect(res.text).toContain('job_last_illust_id');
    expect(res.text).toContain('classification_requests_total');
  });

  it('returns 404 when metrics are disabled', async () => {
    process.env.METRICS_ENABLED = 'false';
    resetCommonJsModules();

    const app = createApp();

    const res = await request(app).get('/metrics').set('x-request-id', 'req-metrics-disabled').expect(404);

    expect(res.body).toMatchObject({
      code: 'METRICS_DISABLED',
      message: 'Metrics endpoint is disabled.',
      request_id: 'req-metrics-disabled',
    });
  });

  it('returns 401 when basic auth is enabled but missing/invalid', async () => {
    process.env.METRICS_BASIC_AUTH_USER = 'user';
    process.env.METRICS_BASIC_AUTH_PASS = 'pass';

    const app = createApp();

    const res = await request(app).get('/metrics').set('x-request-id', 'req-metrics-401').expect(401);

    expect(res.headers['www-authenticate']).toContain('Basic');
    expect(res.body).toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized.',
      request_id: 'req-metrics-401',
    });
  });

  it('returns 200 when basic auth is enabled and correct credentials provided', async () => {
    process.env.METRICS_BASIC_AUTH_USER = 'user';
    process.env.METRICS_BASIC_AUTH_PASS = 'pass';

    const app = createApp();

    const token = Buffer.from('user:pass').toString('base64');
    const res = await request(app).get('/metrics').set('Authorization', `Basic ${token}`).expect(200);

    expect(res.text).toContain('pixivcat_up');
  });
});
