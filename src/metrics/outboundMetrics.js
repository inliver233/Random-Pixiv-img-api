const client = require('prom-client');
const { getMetricsRegistry } = require('./registry');

const METRIC_NAME = 'outbound_errors_total';

const ensureOutboundMetricsState = () => {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatOutboundMetrics ??= {
    initialized: false,
    outboundErrorsTotal: null,
  };

  // eslint-disable-next-line no-underscore-dangle
  return globalThis.__pixivcatOutboundMetrics;
};

function getOutboundErrorsTotalCounter() {
  const state = ensureOutboundMetricsState();

  if (!state.initialized) {
    const registry = getMetricsRegistry();
    state.outboundErrorsTotal = new client.Counter({
      name: METRIC_NAME,
      help: 'Total number of outbound errors classified by type.',
      labelNames: ['type'],
      registers: [registry],
    });
    state.initialized = true;
  }

  return state.outboundErrorsTotal;
}

function ensureOutboundMetricsInitialized() {
  void getOutboundErrorsTotalCounter();
}

function incrementOutboundError(type) {
  getOutboundErrorsTotalCounter().labels(String(type)).inc();
}

module.exports = {
  METRIC_NAME,
  ensureOutboundMetricsInitialized,
  getOutboundErrorsTotalCounter,
  incrementOutboundError,
};

