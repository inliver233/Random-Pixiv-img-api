import logger from '../logger/logger';

export type CircuitAction<T> = () => Promise<T>;

type PixivCircuitState = {
  breaker: any | null;
  listenersAttached: boolean;
};

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function ensurePixivCircuitState(): PixivCircuitState {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatPixivApiCircuit ??= {
    breaker: null,
    listenersAttached: false,
  };

  // eslint-disable-next-line no-underscore-dangle
  return globalThis.__pixivcatPixivApiCircuit as PixivCircuitState;
}

function createPixivApiCircuit(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const CircuitBreaker: any = require('opossum');

  const breaker = new CircuitBreaker(async (action: CircuitAction<any>) => action(), {
    timeout: numberFromEnv('PIXIV_CIRCUIT_TIMEOUT_MS', 12_000),
    resetTimeout: numberFromEnv('PIXIV_CIRCUIT_RESET_TIMEOUT_MS', 30_000),
    errorThresholdPercentage: numberFromEnv('PIXIV_CIRCUIT_ERROR_THRESHOLD_PERCENT', 50),
    volumeThreshold: numberFromEnv('PIXIV_CIRCUIT_VOLUME_THRESHOLD', 10),
    rollingCountTimeout: numberFromEnv('PIXIV_CIRCUIT_ROLLING_COUNT_TIMEOUT_MS', 10_000),
    rollingCountBuckets: numberFromEnv('PIXIV_CIRCUIT_ROLLING_COUNT_BUCKETS', 10),
  });

  if (!booleanFromEnv('PIXIV_CIRCUIT_ENABLED', true) && typeof breaker.disable === 'function') {
    breaker.disable();
  }

  return breaker;
}

export function getPixivApiCircuit(): any {
  const state = ensurePixivCircuitState();
  if (state.breaker) return state.breaker;

  state.breaker = createPixivApiCircuit();

  if (!state.listenersAttached && state.breaker && typeof state.breaker.on === 'function') {
    state.breaker.on('open', () => logger.warn({ circuit: 'pixiv_api' }, 'Pixiv API circuit open'));
    state.breaker.on('halfOpen', () => logger.info({ circuit: 'pixiv_api' }, 'Pixiv API circuit half-open'));
    state.breaker.on('close', () => logger.info({ circuit: 'pixiv_api' }, 'Pixiv API circuit closed'));
    state.listenersAttached = true;
  }

  return state.breaker;
}

export async function pixivApiCircuitFire<T>(action: CircuitAction<T>): Promise<T> {
  return getPixivApiCircuit().fire(action);
}

export function isCircuitOpenError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr: any = err;
  return anyErr.code === 'EOPENBREAKER' || (typeof anyErr.message === 'string' && anyErr.message.includes('Breaker is open'));
}

export function resetPixivApiCircuitForTest(): void {
  const state = ensurePixivCircuitState();
  if (state.breaker && typeof state.breaker.shutdown === 'function') {
    state.breaker.shutdown();
  }
  state.breaker = null;
  state.listenersAttached = false;
}

