import { describe, expect, it } from 'vitest';

import { getPixivApiCircuit, pixivApiCircuitFire, resetPixivApiCircuitForTest } from '../src/resilience/circuit';

function makeProxyConnectError(): any {
  const err: any = new Error('connect ECONNREFUSED 127.0.0.1:1080');
  err.code = 'ECONNREFUSED';
  err.config = { __pixivcat_usedProxy: true };
  return err;
}

function makeUpstream5xxError(): any {
  const err: any = new Error('upstream 503');
  err.response = { status: 503, data: { error: { message: 'Server Error' } } };
  err.config = { __pixivcat_usedProxy: true };
  return err;
}

describe('pixiv API circuit layering', () => {
  it('filters proxy errors so they do not open the Pixiv circuit', async () => {
    process.env.PIXIV_CIRCUIT_ENABLED = 'true';
    process.env.PIXIV_CIRCUIT_VOLUME_THRESHOLD = '2';
    // Opossum opens only when errorRate > threshold (strictly greater).
    process.env.PIXIV_CIRCUIT_ERROR_THRESHOLD_PERCENT = '49';
    process.env.PIXIV_CIRCUIT_ROLLING_COUNT_TIMEOUT_MS = '5000';
    process.env.PIXIV_CIRCUIT_ROLLING_COUNT_BUCKETS = '5';

    resetPixivApiCircuitForTest();

    const proxyErr = makeProxyConnectError();
    await expect(pixivApiCircuitFire(async () => { throw proxyErr; })).rejects.toBe(proxyErr);
    await expect(pixivApiCircuitFire(async () => { throw proxyErr; })).rejects.toBe(proxyErr);

    const breaker = getPixivApiCircuit();
    expect(breaker.stats.failures).toBe(0);
    expect(breaker.opened).toBe(false);

    const upstreamErr = makeUpstream5xxError();
    await expect(pixivApiCircuitFire(async () => { throw upstreamErr; })).rejects.toBe(upstreamErr);
    await expect(pixivApiCircuitFire(async () => { throw upstreamErr; })).rejects.toBe(upstreamErr);

    // After enough counted failures, breaker should open.
    expect(Boolean(getPixivApiCircuit().opened)).toBe(true);

    resetPixivApiCircuitForTest();
  });
});
