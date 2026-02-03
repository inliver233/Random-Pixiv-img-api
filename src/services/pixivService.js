const { pixivApiGet } = require('../http/axiosClient.cjs');
const { isCircuitOpenError, pixivApiCircuitFire } = require('../resilience/circuit.cjs');
const { incrementUpstreamError } = require('../metrics/upstreamMetrics');
const { getEnv } = require('../config/env');
const { getAccessToken, getAccessTokenWithMeta, maskHeader } = require('./pixivAuthService');
const memcachedService = require('./memcachedService');
const logger = require('../logger/logger');

const PIXIV_BASE_URL = 'https://app-api.pixiv.net/v1';

function getHydrateRateLimiterState() {
  globalThis.__pixivcatPixivHydrateRateLimiter ??= {
    global: { inFlight: 0, waiters: [], nextAt: 0 },
    perToken: new Map(),
  };
  return globalThis.__pixivcatPixivHydrateRateLimiter;
}

function normalizeMaxInFlight(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return Number.POSITIVE_INFINITY;
  return n;
}

function normalizeIntervalMs(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquire(entry, maxInFlight) {
  if (entry.inFlight < maxInFlight) {
    entry.inFlight += 1;
    return () => release(entry);
  }

  await new Promise((resolve) => entry.waiters.push(resolve));
  entry.inFlight += 1;
  return () => release(entry);
}

function release(entry) {
  entry.inFlight = Math.max(0, entry.inFlight - 1);
  const next = entry.waiters.shift();
  if (next) next();
}

function getTokenLimiterEntry(state, tokenIndex) {
  const existing = state.perToken.get(tokenIndex);
  if (existing) return existing;
  const created = { inFlight: 0, waiters: [], nextAt: 0 };
  state.perToken.set(tokenIndex, created);
  return created;
}

async function withHydrateRateLimit(tokenIndex, fn) {
  const env = getEnv();
  const state = getHydrateRateLimiterState();

  const globalMaxInFlight = normalizeMaxInFlight(env.HYDRATE_MAX_IN_FLIGHT);
  const tokenMaxInFlight = normalizeMaxInFlight(env.HYDRATE_MAX_IN_FLIGHT_PER_TOKEN);
  const globalMinIntervalMs = normalizeIntervalMs(env.HYDRATE_RATE_LIMIT_GLOBAL_MS);
  const tokenMinIntervalMs = normalizeIntervalMs(env.HYDRATE_RATE_LIMIT_PER_TOKEN_MS);

  const tokenEntry = getTokenLimiterEntry(state, tokenIndex);

  const releaseGlobal = await acquire(state.global, globalMaxInFlight);
  const releaseToken = await acquire(tokenEntry, tokenMaxInFlight);

  try {
    const now = Date.now();
    const waitMs = Math.max(state.global.nextAt - now, tokenEntry.nextAt - now);
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    const startedAt = Date.now();
    state.global.nextAt = startedAt + globalMinIntervalMs;
    tokenEntry.nextAt = startedAt + tokenMinIntervalMs;

    return await fn();
  } finally {
    releaseToken();
    releaseGlobal();
  }
}

const getPixivIllustIdData = async (illustId, cache = true, options = {}) => {
  const env = getEnv();
  const cacheEnabled = Boolean(cache && env.PIXIV_DETAIL_CACHE_ENABLED);
  const cacheTtlSeconds = env.PIXIV_DETAIL_CACHE_TTL_SECONDS;

  if (cacheEnabled) {
    let cachedData = null;
    try {
      cachedData = await memcachedService.get(String(illustId));
    } catch {
      cachedData = null;
    }

    if (cachedData !== null && cachedData !== undefined) {
      logger.info({ illust_id: String(illustId) }, 'Using cached Pixiv API data for illust ID');
      return cachedData;
    }
  }

  try {
    logger.info({ illust_id: String(illustId) }, 'Fetching Pixiv API data for illust ID');
    const fetch = async (accessToken) => pixivApiCircuitFire(async () => pixivApiGet(`${PIXIV_BASE_URL}/illust/detail?illust_id=${illustId}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...maskHeader,
      },
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    }));

    const response = options.rateLimit
      ? await (async () => {
        const meta = await getAccessTokenWithMeta();
        return withHydrateRateLimit(meta.tokenIndex, () => fetch(meta.accessToken));
      })()
      : await fetch(await getAccessToken());

    const status = Number(response?.status);
    const ok = Number.isFinite(status) ? status >= 200 && status < 300 : false;
    const payload = response?.data;
    const hasErrorField = payload && typeof payload === 'object' && 'error' in payload;

    if (cacheEnabled && ok && !hasErrorField) {
      try {
        await memcachedService.set(String(illustId), payload, cacheTtlSeconds);
      } catch {
        // Cache failures must not affect the main request path.
      }
    }

    return response.data;
  } catch (error) {
    if (isCircuitOpenError(error)) {
      const err = new Error('Pixiv API circuit breaker is open.');
      err.code = 'circuit_open';
      throw err;
    }

    const response = error?.response;

    if (response?.status === 403 && response?.data?.error?.message === 'Rate Limit') {
      // API Rate limit exceeded
      incrementUpstreamError('rate_limit');
      const err = new Error('Pixiv API rate limit exceeded.');
      err.code = 'rate_limit';
      throw err;
    }

    if (!response) {
      // Network / no-response errors
      incrementUpstreamError('network');
      const err = new Error('Pixiv API network error');
      err.code = 'network';
      throw err;
    }

    const status = Number(response?.status);
    if (Number.isFinite(status) && status === 403) incrementUpstreamError('403');
    else if (Number.isFinite(status) && status === 404) incrementUpstreamError('404');
    else if (Number.isFinite(status) && status >= 500) incrementUpstreamError('5xx');

    // Other upstream errors
    logger.error({ err: error }, 'Pixiv service error');
    const err = new Error('Pixiv API request failed');
    err.code = 'upstream';
    throw err;
  }
};

module.exports = {
  getPixivIllustIdData,
};
