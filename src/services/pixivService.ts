import { pixivApiGet } from '../http/axiosClient';

import { getAccessToken, maskHeader } from './pixivAuthService';
import memcachedService from './memcachedService';

const PIXIV_BASE_URL = 'https://app-api.pixiv.net/v1';

const getPixivIllustIdData = async (illustId: string | number, cache = true) => {
  if (cache) {
    const cachedData = await memcachedService.get(String(illustId));
    if (cachedData) {
      console.log('Using cached Pixiv API data for illust ID:', illustId);
      return cachedData;
    }
  }

  try {
    console.log('Fetching Pixiv API data for illust ID:', illustId);
    const response = await pixivApiGet(`${PIXIV_BASE_URL}/illust/detail?illust_id=${illustId}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${await getAccessToken()}`,
        ...maskHeader,
      },
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    });
    if (cache) memcachedService.set(String(illustId), response.data);
    return response.data;
  } catch (error: any) {
    const response = error?.response;

    if (response?.status === 403 && response?.data?.error?.message === 'Rate Limit') {
      // API Rate limit exceeded
      const err: any = new Error('Pixiv API rate limit exceeded.');
      err.code = 'rate_limit';
      throw err;
    }

    if (!response) {
      // Network / no-response errors
      const err: any = new Error('Pixiv API network error');
      err.code = 'network';
      throw err;
    }

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
