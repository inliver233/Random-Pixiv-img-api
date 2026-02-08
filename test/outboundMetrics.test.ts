import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

function createApp() {
  const app = express();
  const metricsRoute = require('../src/routes/metrics.js');
  app.use('/metrics', metricsRoute);
  return app;
}

describe('outbound metrics exposed in /metrics', () => {
  const originalMetricsEnabled = process.env.METRICS_ENABLED;
  const originalMetricsUser = process.env.METRICS_BASIC_AUTH_USER;
  const originalMetricsPass = process.env.METRICS_BASIC_AUTH_PASS;
  const originalMetricsAllow = process.env.METRICS_ALLOW_UNAUTHENTICATED;

  beforeEach(() => {
    process.env.METRICS_ENABLED = 'true';
    delete process.env.METRICS_BASIC_AUTH_USER;
    delete process.env.METRICS_BASIC_AUTH_PASS;
    process.env.METRICS_ALLOW_UNAUTHENTICATED = 'true';
  });

  afterEach(() => {
    if (originalMetricsEnabled === undefined) delete process.env.METRICS_ENABLED;
    else process.env.METRICS_ENABLED = originalMetricsEnabled;

    if (originalMetricsUser === undefined) delete process.env.METRICS_BASIC_AUTH_USER;
    else process.env.METRICS_BASIC_AUTH_USER = originalMetricsUser;

    if (originalMetricsPass === undefined) delete process.env.METRICS_BASIC_AUTH_PASS;
    else process.env.METRICS_BASIC_AUTH_PASS = originalMetricsPass;

    if (originalMetricsAllow === undefined) delete process.env.METRICS_ALLOW_UNAUTHENTICATED;
    else process.env.METRICS_ALLOW_UNAUTHENTICATED = originalMetricsAllow;
  });

  it('includes outbound_errors_total and sample labels', async () => {
    const { ensureOutboundMetricsInitialized, incrementOutboundError } = require('../src/metrics/outboundMetrics.js');

    ensureOutboundMetricsInitialized();
    incrementOutboundError('proxy_connect_error');

    const app = createApp();
    const res = await request(app).get('/metrics').expect(200);

    expect(res.text).toContain('outbound_errors_total');
    expect(res.text).toContain('proxy_connect_error');
  });
});
