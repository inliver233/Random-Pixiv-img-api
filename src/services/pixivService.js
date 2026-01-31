const axios = require('axios');
const { getAccessToken, maskHeader } = require('./pixivAuthService');
const memcachedService = require('./memcachedService');

const PIXIV_BASE_URL = 'https://app-api.pixiv.net/v1';

const getPixivIllustIdData = async (illustId, cache = true) => {
  if (cache) {
    const cachedData = await memcachedService.get(illustId);
    if (cachedData) {
      console.log('Using cached Pixiv API data for illust ID:', illustId);
      return cachedData;
    }
  }

  try {
    console.log('Fetching Pixiv API data for illust ID:', illustId);
    const response = await axios.get(`${PIXIV_BASE_URL}/illust/detail?illust_id=${illustId}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${await getAccessToken()}`,
        ...maskHeader,
      },
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    });
    if (cache) memcachedService.set(illustId, response.data);
    return response.data;
  } catch (error) {
    const response = error?.response;

    if (response?.status === 403 && response?.data?.error?.message === 'Rate Limit') {
      // API Rate limit exceeded
      const err = new Error('Pixiv API rate limit exceeded.');
      err.code = 'rate_limit';
      throw err;
    }

    if (!response) {
      // Network / no-response errors
      const err = new Error('Pixiv API network error');
      err.code = 'network';
      throw err;
    }

    // Other upstream errors
    console.error('Pixiv service error:', error);
    const err = new Error('Pixiv API request failed');
    err.code = 'upstream';
    throw err;
  }
};

module.exports = {
  getPixivIllustIdData,
};
