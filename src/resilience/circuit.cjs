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

function safeString(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function getAxiosStatus(err) {
  return safeNumber(err && err.response && err.response.status);
}

function getAxiosData(err) {
  return err && err.response ? err.response.data : undefined;
}

function isProxyAuthFailure(err) {
  const status = getAxiosStatus(err);
  if (status === 407) return true;

  const code = safeString(err && err.code).toLowerCase();
  if (code.includes('auth') && code.includes('socks')) return true;

  const msg = safeString(err && err.message).toLowerCase();
  return msg.includes('proxy authentication') || msg.includes('socks authentication');
}

function isPixivRateLimit(err) {
  const status = getAxiosStatus(err);
  if (status !== 403) return false;
  const data = getAxiosData(err);
  const message = safeString(data && data.error ? data.error.message : '');
  return message === 'Rate Limit';
}

function classifyForCircuit(err, usedProxy) {
  const status = getAxiosStatus(err);

  if (isProxyAuthFailure(err)) return 'proxy_auth';
  if (isPixivRateLimit(err)) return 'pixiv_rate_limit';
  if (status === 403) return 'pixiv_403';
  if (status !== undefined) {
    if (status >= 500 && status <= 599) return 'pixiv_5xx';
    return 'upstream';
  }

  if (usedProxy) return 'proxy_connect';

  const code = safeString(err && err.code).toUpperCase();
  if (['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return 'network';
  }

  return 'unknown';
}

function ensurePixivCircuitState() {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatPixivApiCircuitCjs ??= {
    breaker: null,
    listenersAttached: false,
    lastFailureType: null,
    lastFailureAtMs: null,
    lastFilteredType: null,
    lastFilteredAtMs: null,
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
    errorFilter: (err) => {
      try {
        const usedProxy = Boolean(err && err.config && err.config.__pixivcat_usedProxy);
        const type = classifyForCircuit(err, usedProxy);
        if (type !== 'proxy_connect' && type !== 'proxy_auth') {
          return false;
        }

        const state = ensurePixivCircuitState();
        state.lastFilteredType = type;
        state.lastFilteredAtMs = Date.now();
        return true;
      } catch {
        return false;
      }
    },
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
    state.breaker.on('failure', (err) => {
      try {
        const usedProxy = Boolean(err && err.config && err.config.__pixivcat_usedProxy);
        const type = classifyForCircuit(err, usedProxy);

        const next = ensurePixivCircuitState();
        next.lastFailureType = type;
        next.lastFailureAtMs = Date.now();
      } catch {
        // best-effort
      }
    });

    state.breaker.on('open', () => logger.warn({
      circuit: 'pixiv_api',
      layer: 'pixiv_upstream',
      last_failure_type: state.lastFailureType,
      last_failure_at: state.lastFailureAtMs ? new Date(state.lastFailureAtMs).toISOString() : null,
      last_filtered_type: state.lastFilteredType,
      last_filtered_at: state.lastFilteredAtMs ? new Date(state.lastFilteredAtMs).toISOString() : null,
    }, 'Pixiv API circuit open'));
    state.breaker.on('halfOpen', () => logger.info({ circuit: 'pixiv_api', layer: 'pixiv_upstream' }, 'Pixiv API circuit half-open'));
    state.breaker.on('close', () => logger.info({ circuit: 'pixiv_api', layer: 'pixiv_upstream' }, 'Pixiv API circuit closed'));
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
  state.lastFailureType = null;
  state.lastFailureAtMs = null;
  state.lastFilteredType = null;
  state.lastFilteredAtMs = null;
}

module.exports = {
  getPixivApiCircuit,
  pixivApiCircuitFire,
  isCircuitOpenError,
  resetPixivApiCircuitForTest,
};

module.exports.default = module.exports;
