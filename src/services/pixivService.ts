import { pixivApiGet } from '../http/axiosClient';
import { isCircuitOpenError, pixivApiCircuitFire } from '../resilience/circuit';
import { incrementUpstreamError } from '../metrics/upstreamMetrics';
import { getEnv } from '../config/env';

import { getAccessToken, maskHeader } from './pixivAuthService';
import memcachedService from './memcachedService';

const PIXIV_BASE_URL = 'https://app-api.pixiv.net/v1';

const getPixivIllustIdData = async (illustId: string | number, cache = true) => {
  const env = getEnv();
  const cacheEnabled = Boolean(cache && env.PIXIV_DETAIL_CACHE_ENABLED);
  const cacheTtlSeconds = env.PIXIV_DETAIL_CACHE_TTL_SECONDS;

  if (cacheEnabled) {
    let cachedData: unknown = null;
    try {
      cachedData = await memcachedService.get(String(illustId));
    } catch {
      cachedData = null;
    }

    if (cachedData !== null && cachedData !== undefined) {
      console.log('Using cached Pixiv API data for illust ID:', illustId);
      return cachedData;
    }
  }

  try {
    console.log('Fetching Pixiv API data for illust ID:', illustId);
    const response = await pixivApiCircuitFire(async () => pixivApiGet(`${PIXIV_BASE_URL}/illust/detail?illust_id=${illustId}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${await getAccessToken()}`,
        ...maskHeader,
      },
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    }));

    const status = Number((response as any)?.status);
    const ok = Number.isFinite(status) ? status >= 200 && status < 300 : false;
    const payload = (response as any)?.data;
    const hasErrorField = payload && typeof payload === 'object' && 'error' in payload;

    if (cacheEnabled && ok && !hasErrorField) {
      try {
        await memcachedService.set(String(illustId), payload, cacheTtlSeconds);
      } catch {
        // Cache failures must not affect the main request path.
      }
    }

    return response.data;
  } catch (error: any) {
    if (isCircuitOpenError(error)) {
      const err: any = new Error('Pixiv API circuit breaker is open.');
      err.code = 'circuit_open';
      throw err;
    }

    const response = error?.response;

    if (response?.status === 403 && response?.data?.error?.message === 'Rate Limit') {
      // API Rate limit exceeded
      incrementUpstreamError('rate_limit');
      const err: any = new Error('Pixiv API rate limit exceeded.');
      err.code = 'rate_limit';
      throw err;
    }

    if (!response) {
      // Network / no-response errors
      incrementUpstreamError('network');
      const err: any = new Error('Pixiv API network error');
      err.code = 'network';
      throw err;
    }

    const status = Number(response?.status);
    if (Number.isFinite(status) && status === 403) incrementUpstreamError('403');
    else if (Number.isFinite(status) && status === 404) incrementUpstreamError('404');
    else if (Number.isFinite(status) && status >= 500) incrementUpstreamError('5xx');

    // Other upstream errors
    console.error('Pixiv service error:', error);
    const err: any = new Error('Pixiv API request failed');
    err.code = 'upstream';
    throw err;
  }
};

const pixivService = {
  getPixivIllustIdData,
};

export default pixivService;
