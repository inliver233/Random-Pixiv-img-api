const client = require('prom-client');
const { getMetricsRegistry } = require('./registry');

const METRIC_NAME = 'classification_requests_total';

function ensureState() {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatClassificationMetrics = globalThis.__pixivcatClassificationMetrics || {
    initialized: false,
    counter: null,
  };
  // eslint-disable-next-line no-underscore-dangle
  return globalThis.__pixivcatClassificationMetrics;
}

function getClassificationRequestsTotalCounter() {
  const state = ensureState();
  if (!state.initialized) {
    state.counter = new client.Counter({
      name: METRIC_NAME,
      help: 'Total classification API requests by endpoint and status.',
      labelNames: ['endpoint', 'status'],
      registers: [getMetricsRegistry()],
    });
    state.initialized = true;
  }
  return state.counter;
}

function ensureClassificationMetricsInitialized() {
  getClassificationRequestsTotalCounter();
}

function incClassificationRequest(endpoint, status) {
  getClassificationRequestsTotalCounter().labels(String(endpoint || 'unknown'), String(status || 'error')).inc();
}

module.exports = {
  METRIC_NAME,
  getClassificationRequestsTotalCounter,
  ensureClassificationMetricsInitialized,
  incClassificationRequest,
};
