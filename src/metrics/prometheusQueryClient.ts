import { getEnv } from '../config/env';

type PrometheusApiVectorSample = {
  metric: Record<string, string>;
  value: [number, string];
};

type PrometheusApiScalar = [number, string];

type PrometheusApiSuccess = {
  status: 'success';
  data: {
    resultType: 'vector' | 'matrix' | 'scalar' | 'string';
    result: unknown;
  };
  warnings?: string[];
};

type PrometheusApiError = {
  status: 'error';
  errorType?: string;
  error?: string;
  warnings?: string[];
};

type PrometheusApiResponse = PrometheusApiSuccess | PrometheusApiError;

export type PrometheusInstantQueryResult =
  | {
    ok: true;
    cached: boolean;
    fetchedAt: string;
    data: PrometheusApiSuccess['data'];
  }
  | {
    ok: false;
    cached: boolean;
    fetchedAt: string;
    error: string;
    errorType?: string;
    httpStatus?: number;
  };

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 15_000;

type CacheEntry = {
  expiresAt: number;
  value: PrometheusInstantQueryResult;
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatPrometheusQueryCache: Map<string, CacheEntry> | undefined;
}

function getCache(): Map<string, CacheEntry> {
  globalThis.__pixivcatPrometheusQueryCache ??= new Map<string, CacheEntry>();
  return globalThis.__pixivcatPrometheusQueryCache;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function getPrometheusUrlFromEnv(): string | null {
  const env = getEnv();
  const url = String(env.PROMETHEUS_URL || '').trim();
  return url ? url : null;
}

export async function queryPrometheusInstant(
  query: string,
  options: {
    baseUrl?: string | null;
    timeoutMs?: number;
    cacheTtlMs?: number;
    nowMs?: number;
  } = {},
): Promise<PrometheusInstantQueryResult> {
  const fetchedAt = new Date().toISOString();
  const baseUrl = (options.baseUrl ?? getPrometheusUrlFromEnv()) || null;

  if (!baseUrl) {
    return { ok: false, cached: false, fetchedAt, error: 'not_configured' };
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const cacheKey = `instant:${normalizedBaseUrl}:${query}`;
  const nowMs = options.nowMs ?? Date.now();

  const cache = getCache();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    return { ...cached.value, cached: true };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  const url = new URL(`${normalizedBaseUrl}/api/v1/query`);
  url.searchParams.set('query', query);

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), { signal: abortController.signal });
    const httpStatus = res.status;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const value: PrometheusInstantQueryResult = {
        ok: false,
        cached: false,
        fetchedAt,
        error: `http_${httpStatus}${text ? `:${text}` : ''}`,
        httpStatus,
      };
      cache.set(cacheKey, { expiresAt: nowMs + cacheTtlMs, value });
      return value;
    }

    const json = (await res.json()) as PrometheusApiResponse;

    if (!json || typeof json !== 'object') {
      const value: PrometheusInstantQueryResult = {
        ok: false,
        cached: false,
        fetchedAt,
        error: 'invalid_json',
        httpStatus,
      };
      cache.set(cacheKey, { expiresAt: nowMs + cacheTtlMs, value });
      return value;
    }

    if ((json as PrometheusApiError).status === 'error') {
      const errJson = json as PrometheusApiError;
      const value: PrometheusInstantQueryResult = {
        ok: false,
        cached: false,
        fetchedAt,
        error: errJson.error || 'prometheus_error',
        errorType: errJson.errorType,
        httpStatus,
      };
      cache.set(cacheKey, { expiresAt: nowMs + cacheTtlMs, value });
      return value;
    }

    const okJson = json as PrometheusApiSuccess;
    const value: PrometheusInstantQueryResult = {
      ok: true,
      cached: false,
      fetchedAt,
      data: okJson.data,
    };
    cache.set(cacheKey, { expiresAt: nowMs + cacheTtlMs, value });
    return value;
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && (err as any).name === 'AbortError'
        ? 'timeout'
        : err instanceof Error
          ? err.message
          : String(err);

    const value: PrometheusInstantQueryResult = {
      ok: false,
      cached: false,
      fetchedAt,
      error: message || 'fetch_failed',
    };
    cache.set(cacheKey, { expiresAt: nowMs + cacheTtlMs, value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

export function extractFirstSampleValue(result: PrometheusInstantQueryResult): number | null {
  if (!result.ok) return null;

  const { resultType, result: payload } = result.data;

  if (resultType === 'scalar') {
    const scalar = payload as PrometheusApiScalar;
    const valueText = Array.isArray(scalar) ? String(scalar[1] ?? '') : '';
    const n = Number(valueText);
    return Number.isFinite(n) ? n : null;
  }

  if (resultType === 'vector') {
    const vector = payload as PrometheusApiVectorSample[];
    const first = Array.isArray(vector) ? vector[0] : undefined;
    const value = first && Array.isArray(first.value) ? first.value[1] : undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}
