const logger = require('../logger/logger');

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function booleanFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function ensurePixivCircuitState() {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatPixivApiCircuitCjs ??= {
    breaker: null,
    listenersAttached: false,
  };

  // eslint-disable-next-line no-underscore-dangle
  return globalThis.__pixivcatPixivApiCircuitCjs;
}

function createPixivApiCircuit() {
  const CircuitBreaker = require('opossum');

  const breaker = new CircuitBreaker(async (action) => action(), {
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

function getPixivApiCircuit() {
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

function pixivApiCircuitFire(action) {
  return getPixivApiCircuit().fire(action);
}

function isCircuitOpenError(err) {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err;
  return anyErr.code === 'EOPENBREAKER' || (typeof anyErr.message === 'string' && anyErr.message.includes('Breaker is open'));
}

function resetPixivApiCircuitForTest() {
  const state = ensurePixivCircuitState();
  if (state.breaker && typeof state.breaker.shutdown === 'function') {
    state.breaker.shutdown();
  }
  state.breaker = null;
  state.listenersAttached = false;
}

module.exports = {
  getPixivApiCircuit,
  pixivApiCircuitFire,
  isCircuitOpenError,
  resetPixivApiCircuitForTest,
};

module.exports.default = module.exports;

