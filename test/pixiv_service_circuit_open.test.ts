import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPixivApiCircuitForTest } from '../src/resilience/circuit';

const mockPixivApiGet = vi.fn();
const mockGetAccessTokenWithMeta = vi.fn(async () => ({ accessToken: 'test-access-token', tokenIndex: 0, tokenId: 'env-0' }));

vi.mock('../src/http/axiosClient', () => ({
  pixivApiGet: mockPixivApiGet,
}));

vi.mock('../src/services/pixivAuthService', () => ({
  getAccessTokenWithMeta: mockGetAccessTokenWithMeta,
  maskHeader: {},
}));

vi.mock('../src/services/memcachedService', () => ({
  default: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
  },
}));

describe('pixivService circuit-open classification (ts)', () => {
  beforeEach(() => {
    resetPixivApiCircuitForTest();
    mockPixivApiGet.mockReset();
    mockGetAccessTokenWithMeta.mockReset();

    process.env.PIXIV_CIRCUIT_VOLUME_THRESHOLD = '1';
    process.env.PIXIV_CIRCUIT_ERROR_THRESHOLD_PERCENT = '50';
    process.env.PIXIV_CIRCUIT_RESET_TIMEOUT_MS = '10000';
    process.env.PIXIV_CIRCUIT_TIMEOUT_MS = '50';
  });

  afterEach(() => {
    resetPixivApiCircuitForTest();
    delete process.env.PIXIV_CIRCUIT_VOLUME_THRESHOLD;
    delete process.env.PIXIV_CIRCUIT_ERROR_THRESHOLD_PERCENT;
    delete process.env.PIXIV_CIRCUIT_RESET_TIMEOUT_MS;
    delete process.env.PIXIV_CIRCUIT_TIMEOUT_MS;
  });

  it('throws circuit_open when breaker is open', async () => {
    const pixivService = (await import('../src/services/pixivService.ts')).default;

    mockPixivApiGet.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(pixivService.getPixivIllustIdData(123, false)).rejects.toMatchObject({
      code: 'network',
    });

    await expect(pixivService.getPixivIllustIdData(123, false)).rejects.toMatchObject({
      code: 'circuit_open',
      message: 'Pixiv API circuit breaker is open.',
    });
  });
});
