const client = require('prom-client');
const { getMetricsRegistry } = require('./registry');

const METRIC_NAME = 'upstream_errors_total';

const ensureUpstreamMetricsState = () => {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatUpstreamMetrics ??= {
    initialized: false,
    upstreamErrorsTotal: null,
  };

  // eslint-disable-next-line no-underscore-dangle
  return globalThis.__pixivcatUpstreamMetrics;
};

function getUpstreamErrorsTotalCounter() {
  const state = ensureUpstreamMetricsState();

  if (!state.initialized) {
    const registry = getMetricsRegistry();
    state.upstreamErrorsTotal = new client.Counter({
      name: METRIC_NAME,
      help: 'Total number of upstream errors.',
      labelNames: ['type'],
      registers: [registry],
    });
    state.initialized = true;
  }

  return state.upstreamErrorsTotal;
}

function ensureUpstreamMetricsInitialized() {
  void getUpstreamErrorsTotalCounter();
}

function incrementUpstreamError(type) {
  getUpstreamErrorsTotalCounter().labels(String(type)).inc();
}

module.exports = {
  METRIC_NAME,
  ensureUpstreamMetricsInitialized,
  getUpstreamErrorsTotalCounter,
  incrementUpstreamError,
};

