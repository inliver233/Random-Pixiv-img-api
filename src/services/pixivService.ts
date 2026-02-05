import { pixivApiGet } from '../http/axiosClient';
import { isCircuitOpenError, pixivApiCircuitFire } from '../resilience/circuit';
import { classifyOutboundError } from '../resilience/outboundErrors';
import { retryWithBackoff } from '../resilience/retry';
import { incrementUpstreamError } from '../metrics/upstreamMetrics';
import { getEnv } from '../config/env';
import { getEffectiveRuntimeConfig } from '../config/runtimeConfig';
import logger from '../logger/logger';
import { runWithTokenProxyFailover } from '../proxy/proxyFailover';
import { loadEnabledProxyCandidates } from '../proxy/proxyEndpointStore';
import { withProxyRateLimit } from '../proxy/rateLimit';
import { shouldFailClosedForUrl, shouldProxyUrl } from '../proxy/routing';

import { getAccessTokenWithMeta, maskHeader } from './pixivAuthService';
import memcachedService from './memcachedService';

const PIXIV_BASE_URL = 'https://app-api.pixiv.net/v1';

type PixivDetailRequestOptions = {
  rateLimit?: boolean;
};

type LimiterEntry = {
  inFlight: number;
  waiters: Array<() => void>;
  nextAt: number;
};

type HydrateRateLimiterState = {
  global: LimiterEntry;
  perToken: Map<number, LimiterEntry>;
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatPixivHydrateRateLimiter: HydrateRateLimiterState | undefined;
}

function getHydrateRateLimiterState(): HydrateRateLimiterState {
  globalThis.__pixivcatPixivHydrateRateLimiter ??= {
    global: { inFlight: 0, waiters: [], nextAt: 0 },
    perToken: new Map<number, LimiterEntry>(),
  };
  return globalThis.__pixivcatPixivHydrateRateLimiter;
}

function normalizeMaxInFlight(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return Number.POSITIVE_INFINITY;
  return n;
}

function normalizeIntervalMs(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildProxyRequiredError(url: string): Error {
  const err: any = new Error('Proxy required (fail-closed).');
  err.code = 'proxy_required';
  err.status = 503;
  err.origin_url = url;
  return err;
}

async function acquire(entry: LimiterEntry, maxInFlight: number): Promise<() => void> {
  if (entry.inFlight < maxInFlight) {
    entry.inFlight += 1;
    return () => release(entry);
  }

  await new Promise<void>((resolve) => entry.waiters.push(resolve));
  entry.inFlight += 1;
  return () => release(entry);
}

function release(entry: LimiterEntry): void {
  entry.inFlight = Math.max(0, entry.inFlight - 1);
  const next = entry.waiters.shift();
  if (next) next();
}

function getTokenLimiterEntry(state: HydrateRateLimiterState, tokenIndex: number): LimiterEntry {
  const existing = state.perToken.get(tokenIndex);
  if (existing) return existing;
  const created: LimiterEntry = { inFlight: 0, waiters: [], nextAt: 0 };
  state.perToken.set(tokenIndex, created);
  return created;
}

async function withHydrateRateLimit<T>(tokenIndex: number, fn: () => Promise<T>): Promise<T> {
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

const getPixivIllustIdData = async (illustId: string | number, cache = true, options: PixivDetailRequestOptions = {}) => {
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
      logger.info({ illust_id: String(illustId) }, 'Using cached Pixiv API data for illust ID');
      return cachedData;
    }
  }

  try {
    logger.info({ illust_id: String(illustId) }, 'Fetching Pixiv API data for illust ID');

    const runtimeConfig = await getEffectiveRuntimeConfig();
    const routing = { mode: runtimeConfig.proxyRouteMode, allowlistDomains: runtimeConfig.proxyRouteAllowlistDomains };
    const policy = {
      defaultFailClosed: runtimeConfig.proxyFailClosed,
      failClosedDomains: runtimeConfig.proxyFailClosedDomains,
      failOpenDomains: runtimeConfig.proxyFailOpenDomains,
    };

    const requestUrl = `${PIXIV_BASE_URL}/illust/detail?illust_id=${illustId}`;
    const shouldProxy = runtimeConfig.proxyEnabled && shouldProxyUrl(requestUrl, routing);
    const failClosed = runtimeConfig.proxyEnabled && shouldFailClosedForUrl(requestUrl, { routing, policy });

    const fetchOnce = async (accessToken: string, proxyUri?: string) =>
      pixivApiCircuitFire(async () =>
        pixivApiGet(requestUrl, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...maskHeader,
          },
          proxyUri,
          proxyRouting: routing,
          validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
        }),
      );

    const fetchWithRetry = async (accessToken: string, proxyUri?: string, tokenId?: string, tokenIndex?: number, proxyId?: string) =>
      retryWithBackoff(
        async () => {
          const fetchWithLimits = async () => {
            if (typeof tokenIndex === 'number') {
              return withHydrateRateLimit(tokenIndex, () => fetchOnce(accessToken, proxyUri));
            }
            return fetchOnce(accessToken, proxyUri);
          };

          if (typeof proxyId === 'string' && proxyId.trim() !== '') {
            return withProxyRateLimit(proxyId, fetchWithLimits);
          }

          return fetchWithLimits();
        },
        {
          retries: 2,
          baseDelayMs: 200,
          maxDelayMs: 2000,
          shouldRetry: (err) => {
            if (isCircuitOpenError(err)) return false;
            if ((err as any)?.config?.responseType === 'stream') return false;

            const usedProxy = Boolean((err as any)?.config?.__pixivcat_usedProxy);
            const classification = classifyOutboundError(err, { usedProxy });
            // Avoid amplifying rate limit signals; let the caller handle it explicitly.
            if (classification.type === 'pixiv_rate_limit') {
              if (typeof tokenId === 'string' && tokenId.trim() !== '') {
                try {
                  // eslint-disable-next-line @typescript-eslint/no-var-requires
                  const { incrementPixivTokenRateLimitTotal } = require('../metrics/pixivTokenMetrics') as typeof import('../metrics/pixivTokenMetrics');
                  incrementPixivTokenRateLimitTotal(tokenId);
                } catch {
                  // best-effort
                }
              }
              return false;
            }
            return classification.retryable;
          },
        },
      );

    const getToken = async () => getAccessTokenWithMeta();
    const proxies = shouldProxy ? await loadEnabledProxyCandidates() : [];

    if (shouldProxy && proxies.length === 0 && failClosed) {
      throw buildProxyRequiredError(requestUrl);
    }

    const response = proxies.length > 0
      ? (await runWithTokenProxyFailover({
        getToken,
        proxies,
        request: async ({ accessToken, tokenId, tokenIndex, proxyUri, proxyId }) => {
          const limiterIndex = options.rateLimit ? tokenIndex : undefined;
          const limiterProxyId = options.rateLimit ? proxyId : undefined;
          return fetchWithRetry(accessToken, proxyUri, tokenId, limiterIndex, limiterProxyId);
        },
        options: {
          poolSalt: 'pool:default',
          overrideTtlMs: 20 * 60 * 1000,
          maxProxySwitches: 2,
          maxTokenSwitches: 1,
        },
      })).value
      : await (async () => {
        const { accessToken, tokenIndex, tokenId } = await getToken();
        const limiterIndex = options.rateLimit ? tokenIndex : undefined;
        return fetchWithRetry(accessToken, undefined, tokenId, limiterIndex, undefined);
      })();

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

    if (error && typeof error === 'object' && (error as any).code === 'proxy_required') {
      throw error;
    }

    const response = error?.response;

    if (response?.status === 403 && response?.data?.error?.message === 'Rate Limit') {
      // API Rate limit exceeded
      incrementUpstreamError('rate_limit');
      const err: any = new Error('Pixiv API rate limit exceeded.');
      err.code = 'rate_limit';
      err.cause = error;
      throw err;
    }

    if (!response) {
      // Network / no-response errors
      incrementUpstreamError('network');
      const err: any = new Error('Pixiv API network error');
      err.code = 'network';
      err.cause = error;
      if (error && typeof error === 'object' && (error as any).failoverEvidence) {
        err.failoverEvidence = (error as any).failoverEvidence;
      }
      throw err;
    }

    const status = Number(response?.status);
    if (Number.isFinite(status) && status === 403) incrementUpstreamError('403');
    else if (Number.isFinite(status) && status === 404) incrementUpstreamError('404');
    else if (Number.isFinite(status) && status >= 500) incrementUpstreamError('5xx');

    // Other upstream errors (avoid logging full Axios error objects that may include tokens).
    logger.error(
      {
        err: {
          message: error instanceof Error ? error.message : String(error?.message ?? error),
          code: (error as any)?.code,
          status: (error as any)?.response?.status,
        },
        failover_attempts: Array.isArray((error as any)?.failoverEvidence?.attempts)
          ? (error as any).failoverEvidence.attempts.length
          : 0,
        failover_last_attempt: Array.isArray((error as any)?.failoverEvidence?.attempts) && (error as any).failoverEvidence.attempts.length > 0
          ? (error as any).failoverEvidence.attempts[(error as any).failoverEvidence.attempts.length - 1]
          : null,
      },
      'Pixiv service error',
    );
    const err: any = new Error('Pixiv API request failed');
    err.code = 'upstream';
    err.cause = error;
    if (error && typeof error === 'object' && (error as any).failoverEvidence) {
      err.failoverEvidence = (error as any).failoverEvidence;
    }
    throw err;
  }
};

const pixivService = {
  getPixivIllustIdData,
};

export default pixivService;

export function resetHydrateRateLimitForTest(): void {
  globalThis.__pixivcatPixivHydrateRateLimiter = undefined;
}
