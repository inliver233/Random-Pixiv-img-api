const client = require('prom-client');
const { getMetricsRegistry } = require('./registry');

const METRIC_NAME = 'db_query_duration_seconds';

const ensureDbMetricsState = () => {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatDbMetrics ??= {
    initialized: false,
    dbQueryDurationSeconds: null,
  };

  // eslint-disable-next-line no-underscore-dangle
  return globalThis.__pixivcatDbMetrics;
};

function getDbQueryDurationSecondsHistogram() {
  const state = ensureDbMetricsState();

  if (!state.initialized) {
    const registry = getMetricsRegistry();
    state.dbQueryDurationSeconds = new client.Histogram({
      name: METRIC_NAME,
      help: 'Database query duration in seconds.',
      labelNames: ['query_name'],
      registers: [registry],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    });
    state.initialized = true;
  }

  return state.dbQueryDurationSeconds;
}

function ensureDbMetricsInitialized() {
  void getDbQueryDurationSecondsHistogram();
}

function observeDbQueryDurationSeconds(queryName, durationSeconds) {
  getDbQueryDurationSecondsHistogram().labels(String(queryName)).observe(durationSeconds);
}

module.exports = {
  METRIC_NAME,
  ensureDbMetricsInitialized,
  getDbQueryDurationSecondsHistogram,
  observeDbQueryDurationSeconds,
};

