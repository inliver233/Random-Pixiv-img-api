import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTest } from '../src/config/env';
import { extractFirstSampleValue, queryPrometheusInstant } from '../src/metrics/prometheusQueryClient';

describe('prometheusQueryClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PROMETHEUS_URL;
    resetEnvForTest();
  });

  it('returns not_configured when PROMETHEUS_URL is missing', async () => {
    delete process.env.PROMETHEUS_URL;
    resetEnvForTest();

    const res = await queryPrometheusInstant('1');
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: 'not_configured' });
  });

  it('queries Prometheus and caches instant query results', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: {
          resultType: 'vector',
          result: [{ metric: {}, value: [1700000000, '1'] }],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch as any);

    const res1 = await queryPrometheusInstant('1', { baseUrl: 'http://prometheus.example', nowMs: 0, cacheTtlMs: 10_000 });
    expect(res1.ok).toBe(true);
    expect(res1.cached).toBe(false);
    expect(extractFirstSampleValue(res1)).toBe(1);

    const res2 = await queryPrometheusInstant('1', { baseUrl: 'http://prometheus.example', nowMs: 1, cacheTtlMs: 10_000 });
    expect(res2.ok).toBe(true);
    expect(res2.cached).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

