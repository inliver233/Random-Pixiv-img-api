import client from 'prom-client';

const SUCCESS_METRIC_NAME = 'random_success_total';

type RandomMetricsState = {
  initialized: boolean;
  randomSuccessTotal: client.Counter | null;
};

function ensureRandomMetricsState(): RandomMetricsState {
  // eslint-disable-next-line no-underscore-dangle
  (globalThis as any).__pixivcatRandomMetrics ??= {
    initialized: false,
    randomSuccessTotal: null,
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
    state.initialized = true;
  }

  return state.randomSuccessTotal!;
}

export function ensureRandomMetricsInitialized(): void {
  void getRandomSuccessTotalCounter();
}

export function incrementRandomSuccessTotal(): void {
  getRandomSuccessTotalCounter().inc();
}

export default {
  SUCCESS_METRIC_NAME,
  ensureRandomMetricsInitialized,
  getRandomSuccessTotalCounter,
  incrementRandomSuccessTotal,
};

