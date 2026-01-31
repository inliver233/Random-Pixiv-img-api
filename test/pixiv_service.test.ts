import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const axiosPath = require.resolve('axios');
const pixivAuthServicePath = require.resolve('../src/services/pixivAuthService.js');
const memcachedServicePath = require.resolve('../src/services/memcachedService.js');
const pixivServicePath = require.resolve('../src/services/pixivService.js');

const originalAxios = require.cache[axiosPath];
const originalPixivAuthService = require.cache[pixivAuthServicePath];
const originalMemcachedService = require.cache[memcachedServicePath];
const originalPixivService = require.cache[pixivServicePath];

const mockAxiosGet = vi.fn();
const mockGetAccessToken = vi.fn(async () => 'test-access-token');

let pixivService: any;

function installCommonJsMocks() {
  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: { get: mockAxiosGet },
  } as any;

  require.cache[pixivAuthServicePath] = {
    id: pixivAuthServicePath,
    filename: pixivAuthServicePath,
    loaded: true,
    exports: {
      getAccessToken: mockGetAccessToken,
      maskHeader: {},
    },
  } as any;

  require.cache[memcachedServicePath] = {
    id: memcachedServicePath,
    filename: memcachedServicePath,
    loaded: true,
    exports: {
      get: vi.fn(),
      set: vi.fn(),
    },
  } as any;
}

function restoreCommonJsMocks() {
  if (originalAxios) require.cache[axiosPath] = originalAxios;
  else delete require.cache[axiosPath];

  if (originalPixivAuthService) require.cache[pixivAuthServicePath] = originalPixivAuthService;
  else delete require.cache[pixivAuthServicePath];

  if (originalMemcachedService) require.cache[memcachedServicePath] = originalMemcachedService;
  else delete require.cache[memcachedServicePath];

  if (originalPixivService) require.cache[pixivServicePath] = originalPixivService;
  else delete require.cache[pixivServicePath];
}

describe('pixivService.getPixivIllustIdData (legacy js)', () => {
  beforeAll(() => {
    installCommonJsMocks();

    delete require.cache[pixivServicePath];
    pixivService = require('../src/services/pixivService.js');
  });

  afterAll(() => {
    restoreCommonJsMocks();
  });

  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockGetAccessToken.mockReset();
    mockGetAccessToken.mockResolvedValue('test-access-token');
  });

  it('classifies network errors when error.response is missing', async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(pixivService.getPixivIllustIdData(123, false)).rejects.toMatchObject({
      code: 'network',
      message: 'Pixiv API network error',
    });
  });

  it('classifies rate limit errors', async () => {
    mockAxiosGet.mockRejectedValueOnce({
      response: { status: 403, data: { error: { message: 'Rate Limit' } } },
    });

    await expect(pixivService.getPixivIllustIdData(123, false)).rejects.toMatchObject({
      code: 'rate_limit',
      message: 'Pixiv API rate limit exceeded.',
    });
  });

  it('classifies upstream errors with error.response', async () => {
    mockAxiosGet.mockRejectedValueOnce({
      response: { status: 500, data: {} },
    });

    await expect(pixivService.getPixivIllustIdData(123, false)).rejects.toMatchObject({
      code: 'upstream',
      message: 'Pixiv API request failed',
    });
  });
});

