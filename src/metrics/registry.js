const client = require('prom-client');

const DEFAULT_METRICS_PREFIX = 'nodejs_';

const ensureMetricsState = () => {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatMetrics ??= {
    registry: new client.Registry(),
    defaultMetricsInitialized: false,
    customMetricsInitialized: false,
    upGauge: null,
  };

  // eslint-disable-next-line no-underscore-dangle
  return globalThis.__pixivcatMetrics;
};

const getMetricsRegistry = () => {
  const state = ensureMetricsState();

  if (!state.defaultMetricsInitialized) {
    client.collectDefaultMetrics({
      register: state.registry,
      prefix: DEFAULT_METRICS_PREFIX,
    });
    state.defaultMetricsInitialized = true;
  }

  if (!state.customMetricsInitialized) {
    state.upGauge = new client.Gauge({
      name: 'pixivcat_up',
      help: 'Service is up (always 1 while process is running).',
      registers: [state.registry],
    });
    state.upGauge.set(1);
    state.customMetricsInitialized = true;
  }

  return state.registry;
};

module.exports = {
  getMetricsRegistry,
};

