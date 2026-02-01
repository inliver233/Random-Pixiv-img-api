const axios = require('axios');
const axiosRetry = require('axios-retry').default || require('axios-retry');
const http = require('node:http');
const https = require('node:https');

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

function mergeHeaders(base, override) {
  if (!base && !override) return undefined;
  return {
    ...(base || {}),
    ...(override || {}),
  };
}

function mergeConfig(base, override) {
  if (!override) return base;
  return {
    ...base,
    ...override,
    headers: mergeHeaders(base.headers, override.headers),
  };
}

const MB = 1024 * 1024;

const PIXIV_API_DEFAULTS = {
  timeout: 10_000,
  httpAgent,
  httpsAgent,
  maxContentLength: 2 * MB,
  maxBodyLength: 2 * MB,
};

const PIXIV_IMAGE_DEFAULTS = {
  timeout: 20_000,
  httpAgent,
  httpsAgent,
  maxContentLength: 50 * MB,
  maxBodyLength: 50 * MB,
};

let retryConfigured = false;

function canConfigureRetry() {
  const request = axios && axios.request;
  const interceptors = axios && axios.interceptors;
  const hasInterceptors =
    interceptors &&
    interceptors.request &&
    typeof interceptors.request.use === 'function' &&
    interceptors.response &&
    typeof interceptors.response.use === 'function';
  return typeof request === 'function' && hasInterceptors;
}

function ensureRetryConfigured() {
  if (retryConfigured) return;
  if (!canConfigureRetry()) {
    retryConfigured = true;
    return;
  }

  axiosRetry(axios, {
    retries: 2,
    retryDelay: axiosRetry.exponentialDelay,
    shouldResetTimeout: true,
    retryCondition: (err) => {
      const responseType = err && err.config ? err.config.responseType : undefined;
      if (responseType === 'stream') return false;
      if (err && err.code === 'ECONNABORTED') return true;
      return axiosRetry.isNetworkOrIdempotentRequestError(err);
    },
  });

  retryConfigured = true;
}

ensureRetryConfigured();

async function pixivApiGet(url, config) {
  return axios.get(url, mergeConfig(PIXIV_API_DEFAULTS, config));
}

async function pixivApiRequest(config) {
  return axios.request(mergeConfig(PIXIV_API_DEFAULTS, config));
}

async function pixivImageGet(url, config) {
  return axios.get(url, mergeConfig(PIXIV_IMAGE_DEFAULTS, config));
}

module.exports = {
  pixivApiGet,
  pixivApiRequest,
  pixivImageGet,
};

module.exports.default = module.exports;
