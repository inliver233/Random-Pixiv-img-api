import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTest } from '../src/config/env';
import { resetPixivApiCircuitForTest } from '../src/resilience/circuit';

const mockPixivApiGet = vi.fn();
const mockGetAccessToken = vi.fn(async () => 'test-access-token');
const mockMemcachedGet = vi.fn();
const mockMemcachedSet = vi.fn();

vi.mock('../src/http/axiosClient', () => ({
  pixivApiGet: mockPixivApiGet,
}));

vi.mock('../src/services/pixivAuthService', () => ({
  getAccessToken: mockGetAccessToken,
  maskHeader: {},
}));

vi.mock('../src/services/memcachedService', () => ({
  default: {
    get: mockMemcachedGet,
    set: mockMemcachedSet,
  },
}));

describe('pixivService detail cache (ts)', () => {
  beforeEach(() => {
    resetPixivApiCircuitForTest();
    resetEnvForTest();

    mockPixivApiGet.mockReset();
    mockGetAccessToken.mockReset();
    mockMemcachedGet.mockReset();
    mockMemcachedSet.mockReset();

    delete process.env.PIXIV_DETAIL_CACHE_ENABLED;
    delete process.env.PIXIV_DETAIL_CACHE_TTL_SECONDS;
  });

  afterEach(() => {
    resetPixivApiCircuitForTest();
    resetEnvForTest();
  });

  it('returns cached payload when cache is enabled', async () => {
    process.env.PIXIV_DETAIL_CACHE_ENABLED = 'true';
    resetEnvForTest();

    mockMemcachedGet.mockResolvedValueOnce({ illust: { id: 123 } });

    const pixivService = (await import('../src/services/pixivService.ts')).default;
    const res = await pixivService.getPixivIllustIdData(123, true);

    expect(res).toEqual({ illust: { id: 123 } });
    expect(mockPixivApiGet).not.toHaveBeenCalled();
    expect(mockMemcachedSet).not.toHaveBeenCalled();
  });

  it('fetches and caches on miss when status is 2xx', async () => {
    process.env.PIXIV_DETAIL_CACHE_ENABLED = 'true';
    process.env.PIXIV_DETAIL_CACHE_TTL_SECONDS = '123';
    resetEnvForTest();

    mockMemcachedGet.mockResolvedValueOnce(null);
    mockPixivApiGet.mockResolvedValueOnce({
      status: 200,
      data: { illust: { id: 123 } },
    });

    const pixivService = (await import('../src/services/pixivService.ts')).default;
    const res = await pixivService.getPixivIllustIdData(123, true);

    expect(res).toEqual({ illust: { id: 123 } });
    expect(mockPixivApiGet).toHaveBeenCalledTimes(1);
    expect(mockMemcachedSet).toHaveBeenCalledWith('123', { illust: { id: 123 } }, 123);
  });

  it('does not cache error payloads (404)', async () => {
    process.env.PIXIV_DETAIL_CACHE_ENABLED = 'true';
    resetEnvForTest();

    mockMemcachedGet.mockResolvedValueOnce(null);
    mockPixivApiGet.mockResolvedValueOnce({
      status: 404,
      data: { error: { message: 'not found' } },
    });

    const pixivService = (await import('../src/services/pixivService.ts')).default;
    const res = await pixivService.getPixivIllustIdData(123, true);

    expect(res).toEqual({ error: { message: 'not found' } });
    expect(mockMemcachedSet).not.toHaveBeenCalled();
  });

  it('bypasses cache when cache=false', async () => {
    process.env.PIXIV_DETAIL_CACHE_ENABLED = 'true';
    resetEnvForTest();

    mockMemcachedGet.mockResolvedValueOnce({ illust: { id: 999 } });
    mockPixivApiGet.mockResolvedValueOnce({
      status: 200,
      data: { illust: { id: 123 } },
    });

    const pixivService = (await import('../src/services/pixivService.ts')).default;
    const res = await pixivService.getPixivIllustIdData(123, false);

    expect(res).toEqual({ illust: { id: 123 } });
    expect(mockMemcachedGet).not.toHaveBeenCalled();
    expect(mockPixivApiGet).toHaveBeenCalledTimes(1);
  });

  it('ignores memcached failures and proceeds to fetch', async () => {
    process.env.PIXIV_DETAIL_CACHE_ENABLED = 'true';
    resetEnvForTest();

    mockMemcachedGet.mockRejectedValueOnce(new Error('memcached down'));
    mockPixivApiGet.mockResolvedValueOnce({
      status: 200,
      data: { illust: { id: 123 } },
    });

    const pixivService = (await import('../src/services/pixivService.ts')).default;
    const res = await pixivService.getPixivIllustIdData(123, true);

    expect(res).toEqual({ illust: { id: 123 } });
    expect(mockPixivApiGet).toHaveBeenCalledTimes(1);
  });
});
