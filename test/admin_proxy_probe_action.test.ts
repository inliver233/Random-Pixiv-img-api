import { afterEach, describe, expect, it } from 'vitest';

import { runWithTimeout } from '../src/admin/utils/runWithTimeout';
import { resetProxyHealthForTest, runProxyHealthCheckOnce, stopProxyHealthSchedulerForTest } from '../src/proxy/healthCheck';

describe('admin proxy probe timeout guard', () => {
  afterEach(() => {
    stopProxyHealthSchedulerForTest();
    resetProxyHealthForTest();
  });

  it('returns timeout when probe workflow exceeds guard timeout', async () => {
    const result = await runWithTimeout(
      runProxyHealthCheckOnce({
        candidates: [{ id: 'p1', proxyUri: 'http://proxy-1' }],
        options: { maxConcurrency: 1, timeoutMs: 200, windowSize: 1 },
        probeFn: async () => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return { ok: false, latencyMs: null, error: 'slow-probe' };
        },
      }),
      15,
    );

    expect(result.status).toBe('timeout');
  });
});

