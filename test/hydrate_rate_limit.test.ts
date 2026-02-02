import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTest } from '../src/config/env.ts';
import pixivService, { resetHydrateRateLimitForTest } from '../src/services/pixivService.ts';

const mockPixivApiGet = vi.hoisted(() => vi.fn());
const mockPixivApiCircuitFire = vi.hoisted(() => vi.fn(async (fn: any) => fn()));
const mockMemcachedGet = vi.hoisted(() => vi.fn());
const mockMemcachedSet = vi.hoisted(() => vi.fn());
const mockGetAccessTokenWithMeta = vi.hoisted(() => vi.fn());

vi.mock('../src/http/axiosClient', () => ({
  pixivApiGet: mockPixivApiGet,
}));

vi.mock('../src/resilience/circuit', () => ({
  pixivApiCircuitFire: mockPixivApiCircuitFire,
  isCircuitOpenError: () => false,
}));

vi.mock('../src/metrics/upstreamMetrics', () => ({
  incrementUpstreamError: vi.fn(),
}));

vi.mock('../src/services/memcachedService', () => ({
  default: {
    get: mockMemcachedGet,
    set: mockMemcachedSet,
  },
}));

vi.mock('../src/services/pixivAuthService', () => ({
  getAccessToken: vi.fn(async () => 'token_default'),
  getAccessTokenWithMeta: mockGetAccessTokenWithMeta,
  maskHeader: { 'User-Agent': 'test-agent' },
}));

function buildPixivDetail(illustId: string) {
  return {
    illust: {
      page_count: 1,
      meta_single_page: {
        original_image_url: `https://i.pximg.net/img-original/img/2026/02/01/00/00/00/${illustId}_p0.jpg`,
      },
      width: 1000,
      height: 800,
      x_restrict: 0,
      ai_type: 0,
      user: { id: 1, name: 'u' },
      title: 't',
      create_date: '2026-02-01T00:00:00+00:00',
      tags: ['tag1'],
    },
  };
}

describe('pixivService.getPixivIllustIdData rateLimit option', () => {
  beforeEach(() => {
    resetEnvForTest();
    resetHydrateRateLimitForTest();
    mockPixivApiGet.mockReset();
    mockPixivApiCircuitFire.mockReset();
    mockMemcachedGet.mockReset();
    mockMemcachedSet.mockReset();
    mockGetAccessTokenWithMeta.mockReset();
    mockPixivApiCircuitFire.mockImplementation(async (fn: any) => fn());

    delete process.env.HYDRATE_MAX_IN_FLIGHT;
    delete process.env.HYDRATE_MAX_IN_FLIGHT_PER_TOKEN;
    delete process.env.HYDRATE_RATE_LIMIT_GLOBAL_MS;
    delete process.env.HYDRATE_RATE_LIMIT_PER_TOKEN_MS;
  });

  it('uses cached Pixiv detail without selecting token or calling upstream', async () => {
    const cached = buildPixivDetail('123');
    mockMemcachedGet.mockResolvedValueOnce(cached);

    const data = await pixivService.getPixivIllustIdData('123', true, { rateLimit: true });

    expect(mockGetAccessTokenWithMeta).not.toHaveBeenCalled();
    expect(mockPixivApiGet).not.toHaveBeenCalled();
    expect(data).toEqual(cached);
  });

  it('on cache miss, fetches Pixiv detail with selected access token and caches 2xx payload', async () => {
    const payload = buildPixivDetail('123');
    mockMemcachedGet.mockResolvedValueOnce(null);
    mockGetAccessTokenWithMeta.mockResolvedValueOnce({ accessToken: 'token_1', tokenIndex: 0 });
    mockPixivApiGet.mockResolvedValueOnce({ status: 200, data: payload });

    const data = await pixivService.getPixivIllustIdData('123', true, { rateLimit: true });

    expect(mockGetAccessTokenWithMeta).toHaveBeenCalledTimes(1);
    expect(mockPixivApiGet).toHaveBeenCalledWith(
      expect.stringContaining('illust_id=123'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token_1',
        }),
      }),
    );
    expect(mockMemcachedSet).toHaveBeenCalledWith('123', payload, 3600);
    expect(data).toEqual(payload);
  });

  it('enforces global min interval between upstream calls', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-02T00:00:00.000Z'));

    try {
      process.env.HYDRATE_MAX_IN_FLIGHT = '1';
      process.env.HYDRATE_MAX_IN_FLIGHT_PER_TOKEN = '0';
      process.env.HYDRATE_RATE_LIMIT_GLOBAL_MS = '1000';
      process.env.HYDRATE_RATE_LIMIT_PER_TOKEN_MS = '0';
      resetEnvForTest();

      mockGetAccessTokenWithMeta.mockResolvedValue({ accessToken: 'token_1', tokenIndex: 0 });

      const callTimes: number[] = [];
      mockPixivApiGet.mockImplementation(async (url: string) => {
        const m = /illust_id=(\d+)/.exec(url);
        const id = m?.[1] ?? '0';
        callTimes.push(Date.now());
        return { status: 200, data: buildPixivDetail(id) };
      });

      const p1 = pixivService.getPixivIllustIdData('123', false, { rateLimit: true });
      const p2 = pixivService.getPixivIllustIdData('124', false, { rateLimit: true });

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(callTimes.length).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);

      await Promise.all([p1, p2]);

      expect(callTimes.length).toBe(2);
      expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(1000);
    } finally {
      vi.useRealTimers();
    }
  });
});
