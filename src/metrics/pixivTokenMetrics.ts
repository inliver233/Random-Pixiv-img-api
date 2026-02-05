import client from 'prom-client';

const REFRESH_TOTAL_METRIC_NAME = 'pixiv_token_refresh_total';
const BACKOFF_UNTIL_METRIC_NAME = 'pixiv_token_refresh_backoff_until_timestamp';
const USE_TOTAL_METRIC_NAME = 'pixiv_token_use_total';
const RATE_LIMIT_TOTAL_METRIC_NAME = 'pixiv_token_rate_limit_total';

type PixivTokenMetricsState = {
  initialized: boolean;
  refreshTotal: client.Counter<'token_id' | 'outcome'> | null;
  backoffUntil: client.Gauge<'token_id'> | null;
  useTotal: client.Counter<'token_id'> | null;
  rateLimitTotal: client.Counter<'token_id'> | null;
};

function ensurePixivTokenMetricsState(): PixivTokenMetricsState {
  // eslint-disable-next-line no-underscore-dangle
  (globalThis as any).__pixivcatPixivTokenMetrics ??= {
    initialized: false,
    refreshTotal: null,
    backoffUntil: null,
    useTotal: null,
    rateLimitTotal: null,
  } satisfies PixivTokenMetricsState;

  // eslint-disable-next-line no-underscore-dangle
  return (globalThis as any).__pixivcatPixivTokenMetrics as PixivTokenMetricsState;
}

function ensureInitialized(): PixivTokenMetricsState {
  const state = ensurePixivTokenMetricsState();
  if (state.initialized) return state;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getMetricsRegistry } = require('./registry') as { getMetricsRegistry: () => client.Registry };
  const registry = getMetricsRegistry();

  state.refreshTotal = new client.Counter({
    name: REFRESH_TOTAL_METRIC_NAME,
    help: 'Total number of Pixiv token refresh attempts.',
    labelNames: ['token_id', 'outcome'],
    registers: [registry],
  });

  state.backoffUntil = new client.Gauge({
    name: BACKOFF_UNTIL_METRIC_NAME,
    help: 'Epoch timestamp (seconds) when a token refresh backoff ends (0 means not in backoff).',
    labelNames: ['token_id'],
    registers: [registry],
  });

  state.useTotal = new client.Counter({
    name: USE_TOTAL_METRIC_NAME,
    help: 'Total number of Pixiv token usages (token selected for a request).',
    labelNames: ['token_id'],
    registers: [registry],
  });

  state.rateLimitTotal = new client.Counter({
    name: RATE_LIMIT_TOTAL_METRIC_NAME,
    help: 'Total number of Pixiv API rate limit responses per token.',
    labelNames: ['token_id'],
    registers: [registry],
  });

  state.initialized = true;
  return state;
}

export function ensurePixivTokenMetricsInitialized(): void {
  void ensureInitialized();
}

export function getPixivTokenRefreshTotalCounter(): client.Counter<'token_id' | 'outcome'> {
  return ensureInitialized().refreshTotal!;
}

export function getPixivTokenRefreshBackoffUntilGauge(): client.Gauge<'token_id'> {
  return ensureInitialized().backoffUntil!;
}

export function getPixivTokenUseTotalCounter(): client.Counter<'token_id'> {
  return ensureInitialized().useTotal!;
}

export function getPixivTokenRateLimitTotalCounter(): client.Counter<'token_id'> {
  return ensureInitialized().rateLimitTotal!;
}

export function setPixivTokenBackoffUntilMs(tokenId: string, backoffUntilMs: number): void {
  const value = backoffUntilMs > 0 ? backoffUntilMs / 1000 : 0;
  getPixivTokenRefreshBackoffUntilGauge().labels(String(tokenId)).set(value);
}

export function incrementPixivTokenUseTotal(tokenId: string): void {
  getPixivTokenUseTotalCounter().labels(String(tokenId)).inc();
}

export function incrementPixivTokenRateLimitTotal(tokenId: string): void {
  getPixivTokenRateLimitTotalCounter().labels(String(tokenId)).inc();
}

export function recordPixivTokenRefreshSuccess(tokenId: string): void {
  getPixivTokenRefreshTotalCounter().labels(String(tokenId), 'success').inc();
  setPixivTokenBackoffUntilMs(tokenId, 0);
}

export function recordPixivTokenRefreshFail(tokenId: string, backoffUntilMs: number): void {
  getPixivTokenRefreshTotalCounter().labels(String(tokenId), 'fail').inc();
  setPixivTokenBackoffUntilMs(tokenId, backoffUntilMs);
}

export default {
  REFRESH_TOTAL_METRIC_NAME,
  BACKOFF_UNTIL_METRIC_NAME,
  USE_TOTAL_METRIC_NAME,
  RATE_LIMIT_TOTAL_METRIC_NAME,
  ensurePixivTokenMetricsInitialized,
  getPixivTokenRefreshTotalCounter,
  getPixivTokenRefreshBackoffUntilGauge,
  getPixivTokenUseTotalCounter,
  getPixivTokenRateLimitTotalCounter,
  setPixivTokenBackoffUntilMs,
  incrementPixivTokenUseTotal,
  incrementPixivTokenRateLimitTotal,
  recordPixivTokenRefreshSuccess,
  recordPixivTokenRefreshFail,
};
