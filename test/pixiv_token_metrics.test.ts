import { describe, expect, it } from 'vitest';

import {
  incrementPixivTokenRateLimitTotal,
  incrementPixivTokenUseTotal,
  recordPixivTokenRefreshFail,
  recordPixivTokenRefreshSuccess,
} from '../src/metrics/pixivTokenMetrics';

describe('pixivTokenMetrics', () => {
  it('registers refresh/use/rate-limit metrics', async () => {
    const tokenId = 'test-token';

    recordPixivTokenRefreshSuccess(tokenId);
    recordPixivTokenRefreshFail(tokenId, Date.now() + 60_000);
    incrementPixivTokenUseTotal(tokenId);
    incrementPixivTokenRateLimitTotal(tokenId);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMetricsRegistry } = require('../src/metrics/registry') as { getMetricsRegistry: () => { metrics: () => Promise<string> } };
    const registry = getMetricsRegistry();
    const text = await registry.metrics();

    expect(text).toContain('pixiv_token_refresh_total');
    expect(text).toContain('pixiv_token_refresh_backoff_until_timestamp');
    expect(text).toContain('pixiv_token_use_total');
    expect(text).toContain('pixiv_token_rate_limit_total');
  });
});

