import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureProxyHealthSchedulerStarted,
  filterProxyCandidatesByHealth,
  resetProxyHealthForTest,
  runProxyHealthCheckOnce,
  stopProxyHealthSchedulerForTest,
} from '../src/proxy/healthCheck';

describe('proxy health check', () => {
  beforeEach(() => {
    resetProxyHealthForTest();
  });

  afterEach(() => {
    stopProxyHealthSchedulerForTest();
    vi.useRealTimers();
  });

  it('keeps unknown proxies before any samples exist', () => {
    const candidates = [
      { id: 'p1', proxyUri: 'http://proxy-1' },
      { id: 'p2', proxyUri: 'http://proxy-2' },
    ];

    const filtered = filterProxyCandidatesByHealth(candidates, { minSuccessRate: 1, maxLatencyMs: 1 });
    expect(filtered.map((c) => c.id)).toEqual(['p1', 'p2']);
  });

  it('records probe samples and filters unhealthy proxies', async () => {
    const candidates = [
      { id: 'p1', proxyUri: 'http://proxy-1' },
      { id: 'p2', proxyUri: 'http://proxy-2' },
    ];

    const probeFn = vi.fn(async (candidate: { id: string }) => {
      if (candidate.id === 'p1') return { ok: true, latencyMs: 120, error: null };
      return { ok: false, latencyMs: 500, error: 'timeout' };
    });

    const report = await runProxyHealthCheckOnce({
      candidates,
      probeFn,
      options: {
        windowSize: 3,
        minSuccessRate: 0.6,
        maxLatencyMs: 1000,
        minHealthy: 1,
      },
    });

    expect(report.total).toBe(2);
    expect(report.healthy).toBe(1);
    expect(report.ok).toBe(true);
    expect(report.entries.find((e) => e.id === 'p1')?.status).toBe('healthy');

    const filtered = filterProxyCandidatesByHealth(candidates, { minSuccessRate: 0.6, maxLatencyMs: 1000 });
    expect(filtered.map((c) => c.id)).toEqual(['p1']);

    // The report includes sampled entries; verify p2 is not healthy.
    expect(report.entries.find((e) => e.id === 'p2')?.status).not.toBe('healthy');
    expect(probeFn).toHaveBeenCalledTimes(2);
  });

  it('respects minSuccessRate and maxLatencyMs thresholds for health', async () => {
    const candidates = [{ id: 'p1', proxyUri: 'http://proxy-1' }];

    let calls = 0;
    const probeFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { ok: true, latencyMs: 100, error: null };
      if (calls === 2) return { ok: false, latencyMs: 100, error: 'timeout' };
      return { ok: true, latencyMs: 10_000, error: null };
    });

    await runProxyHealthCheckOnce({
      candidates,
      probeFn,
      options: { windowSize: 3, minSuccessRate: 0.6, maxLatencyMs: 5000 },
    });
    await runProxyHealthCheckOnce({
      candidates,
      probeFn,
      options: { windowSize: 3, minSuccessRate: 0.6, maxLatencyMs: 5000 },
    });
    const report = await runProxyHealthCheckOnce({
      candidates,
      probeFn,
      options: { windowSize: 3, minSuccessRate: 0.6, maxLatencyMs: 5000, minHealthy: 1 },
    });

    expect(report.entries[0]?.status).not.toBe('healthy');
    expect(report.ok).toBe(false);
  });

  it('runs periodic refresh when scheduler is started', async () => {
    vi.useFakeTimers();

    const candidates = [{ id: 'p1', proxyUri: 'http://proxy-1' }];
    const probeFn = vi.fn(async () => ({ ok: true, latencyMs: 10, error: null }));
    const options = { intervalMs: 1000, windowSize: 2 };

    ensureProxyHealthSchedulerStarted({ allowInTest: true, candidates, probeFn, options });
    await runProxyHealthCheckOnce({ candidates, probeFn, options });
    expect(probeFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await runProxyHealthCheckOnce({ candidates, probeFn, options });
    expect(probeFn).toHaveBeenCalledTimes(2);
  });
});
