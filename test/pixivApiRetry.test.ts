import { beforeEach, describe, expect, it, vi } from 'vitest';

import { computeExponentialBackoffDelayMs } from '../src/resilience/retry';

const mockPixivApiGet = vi.hoisted(() => vi.fn());
const mockPixivApiCircuitFire = vi.hoisted(() => vi.fn(async (fn: any) => fn()));
const mockIsCircuitOpenError = vi.hoisted(() => vi.fn(() => false));
const mockIncrementUpstreamError = vi.hoisted(() => vi.fn());
const mockMemcachedGet = vi.hoisted(() => vi.fn());
const mockMemcachedSet = vi.hoisted(() => vi.fn());
const mockGetAccessTokenWithMeta = vi.hoisted(() =>
  vi.fn(async () => ({ accessToken: 'token123', tokenIndex: 0, tokenId: 't1' })),
);
const mockLoadEnabledProxyCandidates = vi.hoisted(() => vi.fn(async () => []));

vi.mock('../src/http/axiosClient', () => ({
  pixivApiGet: mockPixivApiGet,
}));

vi.mock('../src/resilience/circuit', () => ({
  pixivApiCircuitFire: mockPixivApiCircuitFire,
  isCircuitOpenError: mockIsCircuitOpenError,
}));

vi.mock('../src/metrics/upstreamMetrics', () => ({
  incrementUpstreamError: mockIncrementUpstreamError,
}));

vi.mock('../src/services/memcachedService', () => ({
  default: {
    get: mockMemcachedGet,
    set: mockMemcachedSet,
  },
}));

vi.mock('../src/services/pixivAuthService', () => ({
  getAccessTokenWithMeta: mockGetAccessTokenWithMeta,
  maskHeader: { 'User-Agent': 'test-agent' },
}));

vi.mock('../src/proxy/proxyEndpointStore', () => ({
  loadEnabledProxyCandidates: mockLoadEnabledProxyCandidates,
}));

import pixivService from '../src/services/pixivService.ts';

describe('pixiv API retry (same token+proxy combo)', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockPixivApiGet.mockReset();
    mockPixivApiCircuitFire.mockReset();
    mockIsCircuitOpenError.mockReset();
    mockIncrementUpstreamError.mockReset();
    mockMemcachedGet.mockReset();
    mockMemcachedSet.mockReset();
    mockGetAccessTokenWithMeta.mockReset();
    mockLoadEnabledProxyCandidates.mockReset();
    mockPixivApiCircuitFire.mockImplementation(async (fn: any) => fn());
    mockIsCircuitOpenError.mockReturnValue(false);
  });

  it('retries on proxy connect errors and reuses the same token', async () => {
    vi.useFakeTimers();

    mockPixivApiGet
      .mockRejectedValueOnce({ config: { __pixivcat_usedProxy: true }, message: 'proxy down' })
      .mockRejectedValueOnce({ config: { __pixivcat_usedProxy: true }, message: 'proxy still down' })
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const promise = pixivService.getPixivIllustIdData('123', false);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ ok: true });
    expect(mockGetAccessTokenWithMeta).toHaveBeenCalledTimes(1);
    expect(mockPixivApiGet).toHaveBeenCalledTimes(3);
  });

  it('does not retry on rate limit errors', async () => {
    mockPixivApiGet.mockRejectedValueOnce({
      response: { status: 403, data: { error: { message: 'Rate Limit' } } },
      config: {},
    });

    await expect(pixivService.getPixivIllustIdData('123', false)).rejects.toMatchObject({ code: 'rate_limit' });
    expect(mockPixivApiGet).toHaveBeenCalledTimes(1);
  });

  it('does not retry when responseType=stream (guard)', async () => {
    mockPixivApiGet.mockRejectedValueOnce({
      config: { responseType: 'stream' },
      code: 'ECONNABORTED',
      message: 'timeout',
    });

    await expect(pixivService.getPixivIllustIdData('123', false)).rejects.toMatchObject({ code: 'network' });
    expect(mockPixivApiGet).toHaveBeenCalledTimes(1);
  });
});

describe('computeExponentialBackoffDelayMs', () => {
  it('returns exponential delays capped by maxDelayMs', () => {
    expect(computeExponentialBackoffDelayMs({ attempt: 0, baseDelayMs: 200, factor: 2, maxDelayMs: 2000 })).toBe(200);
    expect(computeExponentialBackoffDelayMs({ attempt: 1, baseDelayMs: 200, factor: 2, maxDelayMs: 2000 })).toBe(400);
    expect(computeExponentialBackoffDelayMs({ attempt: 2, baseDelayMs: 200, factor: 2, maxDelayMs: 2000 })).toBe(800);
    expect(computeExponentialBackoffDelayMs({ attempt: 3, baseDelayMs: 200, factor: 2, maxDelayMs: 2000 })).toBe(1600);
    expect(computeExponentialBackoffDelayMs({ attempt: 4, baseDelayMs: 200, factor: 2, maxDelayMs: 2000 })).toBe(2000);
  });
});
