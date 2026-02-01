const client = require('prom-client');
const { getMetricsRegistry } = require('./registry');

const SUCCESS_METRIC_NAME = 'random_success_total';
const FAIL_METRIC_NAME = 'random_fail_total';
const ATTEMPTS_HISTOGRAM_NAME = 'random_attempts_histogram';

const ensureRandomMetricsState = () => {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatRandomMetrics ??= {
    initialized: false,
    randomSuccessTotal: null,
    randomFailTotal: null,
    randomAttemptsHistogram: null,
  };

  // eslint-disable-next-line no-underscore-dangle
  return globalThis.__pixivcatRandomMetrics;
};

function getRandomSuccessTotalCounter() {
  const state = ensureRandomMetricsState();

  if (!state.initialized) {
    const registry = getMetricsRegistry();
    state.randomSuccessTotal = new client.Counter({
      name: SUCCESS_METRIC_NAME,
      help: 'Total number of successful /random responses.',
      registers: [registry],
    });
    state.randomFailTotal = new client.Counter({
      name: FAIL_METRIC_NAME,
      help: 'Total number of failed /random responses.',
      registers: [registry],
    });
    state.randomAttemptsHistogram = new client.Histogram({
      name: ATTEMPTS_HISTOGRAM_NAME,
      help: 'Distribution of attempts used for /random stream selection.',
      registers: [registry],
      buckets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    state.initialized = true;
  }

  return state.randomSuccessTotal;
}

function getRandomFailTotalCounter() {
  const state = ensureRandomMetricsState();
  if (!state.initialized) void getRandomSuccessTotalCounter();
  return state.randomFailTotal;
}

function ensureRandomMetricsInitialized() {
  void getRandomSuccessTotalCounter();
}

function incrementRandomSuccessTotal() {
  getRandomSuccessTotalCounter().inc();
}

function incrementRandomFailTotal() {
  getRandomFailTotalCounter().inc();
}

function observeRandomAttemptsHistogram(attemptsUsed) {
  const state = ensureRandomMetricsState();
  if (!state.initialized) void getRandomSuccessTotalCounter();
  state.randomAttemptsHistogram.observe(attemptsUsed);
}

module.exports = {
  SUCCESS_METRIC_NAME,
  FAIL_METRIC_NAME,
  ATTEMPTS_HISTOGRAM_NAME,
  ensureRandomMetricsInitialized,
  getRandomSuccessTotalCounter,
  getRandomFailTotalCounter,
  incrementRandomSuccessTotal,
  incrementRandomFailTotal,
  observeRandomAttemptsHistogram,
};
