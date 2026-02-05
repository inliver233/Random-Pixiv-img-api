import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPixivApiGet = vi.hoisted(() => vi.fn());
const mockPixivApiCircuitFire = vi.hoisted(() => vi.fn(async (fn: any) => fn()));
const mockGetAccessTokenWithMeta = vi.hoisted(() => vi.fn());
const mockRunWithTokenProxyFailover = vi.hoisted(() => vi.fn());
const mockLoadEnabledProxyCandidates = vi.hoisted(() => vi.fn());

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
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../src/services/pixivAuthService', () => ({
  getAccessToken: vi.fn(async () => 'token_default'),
  getAccessTokenWithMeta: mockGetAccessTokenWithMeta,
  maskHeader: { 'User-Agent': 'test-agent' },
}));

vi.mock('../src/proxy/proxyEndpointStore', () => ({
  loadEnabledProxyCandidates: mockLoadEnabledProxyCandidates,
}));

vi.mock('../src/proxy/proxyFailover', () => ({
  runWithTokenProxyFailover: mockRunWithTokenProxyFailover,
}));

import { resetEnvForTest } from '../src/config/env.ts';
import { resetProxyRateLimitForTest } from '../src/proxy/rateLimit.ts';
import pixivService, { resetHydrateRateLimitForTest } from '../src/services/pixivService.ts';

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

describe('pixivService proxy egress rate limit', () => {
  beforeEach(() => {
    resetEnvForTest();
    resetHydrateRateLimitForTest();
    resetProxyRateLimitForTest();

    mockPixivApiGet.mockReset();
    mockPixivApiCircuitFire.mockReset();
    mockGetAccessTokenWithMeta.mockReset();
    mockRunWithTokenProxyFailover.mockReset();
    mockLoadEnabledProxyCandidates.mockReset();
    mockPixivApiCircuitFire.mockImplementation(async (fn: any) => fn());

    delete process.env.PROXY_RATE_LIMIT_MAX_IN_FLIGHT_PER_PROXY;
    delete process.env.PROXY_RATE_LIMIT_PER_PROXY_MS;
    delete process.env.HYDRATE_MAX_IN_FLIGHT;
    delete process.env.HYDRATE_MAX_IN_FLIGHT_PER_TOKEN;
    delete process.env.HYDRATE_RATE_LIMIT_GLOBAL_MS;
    delete process.env.HYDRATE_RATE_LIMIT_PER_TOKEN_MS;

    mockLoadEnabledProxyCandidates.mockResolvedValue([
      { id: 'p1', proxyUri: 'http://127.0.0.1:8888' },
    ]);

    mockRunWithTokenProxyFailover.mockImplementation(async (params: any) => {
      const token = await params.getToken();
      const proxy = params.proxies?.[0];
      const value = await params.request({
        ...token,
        proxyId: proxy?.id,
        proxyUri: proxy?.proxyUri,
      });
      return { value, evidence: { attempts: [] } };
    });
  });

  it('enforces per-proxy min interval between upstream calls', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-02T00:00:00.000Z'));

    try {
      process.env.PROXY_RATE_LIMIT_MAX_IN_FLIGHT_PER_PROXY = '1';
      process.env.PROXY_RATE_LIMIT_PER_PROXY_MS = '1000';
      process.env.HYDRATE_MAX_IN_FLIGHT = '0';
      process.env.HYDRATE_MAX_IN_FLIGHT_PER_TOKEN = '0';
      process.env.HYDRATE_RATE_LIMIT_GLOBAL_MS = '0';
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

      for (let i = 0; i < 20 && callTimes.length === 0; i += 1) {
        await Promise.resolve();
      }

      expect(mockLoadEnabledProxyCandidates).toHaveBeenCalled();
      expect(mockRunWithTokenProxyFailover).toHaveBeenCalled();
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
