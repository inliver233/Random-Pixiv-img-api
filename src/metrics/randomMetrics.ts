import client from 'prom-client';

const SUCCESS_METRIC_NAME = 'random_success_total';
const FAIL_METRIC_NAME = 'random_fail_total';
const ATTEMPTS_HISTOGRAM_NAME = 'random_attempts_histogram';

type RandomMetricsState = {
  initialized: boolean;
  randomSuccessTotal: client.Counter | null;
  randomFailTotal: client.Counter | null;
  randomAttemptsHistogram: client.Histogram | null;
};

function ensureRandomMetricsState(): RandomMetricsState {
  // eslint-disable-next-line no-underscore-dangle
  (globalThis as any).__pixivcatRandomMetrics ??= {
    initialized: false,
    randomSuccessTotal: null,
    randomFailTotal: null,
    randomAttemptsHistogram: null,
  } satisfies RandomMetricsState;

  // eslint-disable-next-line no-underscore-dangle
  return (globalThis as any).__pixivcatRandomMetrics as RandomMetricsState;
}

export function getRandomSuccessTotalCounter(): client.Counter {
  const state = ensureRandomMetricsState();

  if (!state.initialized) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMetricsRegistry } = require('./registry') as { getMetricsRegistry: () => client.Registry };

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

  return state.randomSuccessTotal!;
}

export function getRandomFailTotalCounter(): client.Counter {
  const state = ensureRandomMetricsState();
  if (!state.initialized) void getRandomSuccessTotalCounter();
  return state.randomFailTotal!;
}

export function ensureRandomMetricsInitialized(): void {
  void getRandomSuccessTotalCounter();
}

export function incrementRandomSuccessTotal(): void {
  getRandomSuccessTotalCounter().inc();
}

export function incrementRandomFailTotal(): void {
  getRandomFailTotalCounter().inc();
}

export function observeRandomAttemptsHistogram(attemptsUsed: number): void {
  const state = ensureRandomMetricsState();
  if (!state.initialized) void getRandomSuccessTotalCounter();
  state.randomAttemptsHistogram!.observe(attemptsUsed);
}

export default {
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
