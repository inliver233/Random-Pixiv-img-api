import client from 'prom-client';

const METRIC_NAME = 'db_query_duration_seconds';

type DbMetricsState = {
  initialized: boolean;
  dbQueryDurationSeconds: client.Histogram<'query_name'> | null;
};

function ensureDbMetricsState(): DbMetricsState {
  // eslint-disable-next-line no-underscore-dangle
  (globalThis as any).__pixivcatDbMetrics ??= {
    initialized: false,
    dbQueryDurationSeconds: null,
  } satisfies DbMetricsState;

  // eslint-disable-next-line no-underscore-dangle
  return (globalThis as any).__pixivcatDbMetrics as DbMetricsState;
}

export function getDbQueryDurationSecondsHistogram(): client.Histogram<'query_name'> {
  const state = ensureDbMetricsState();

  if (!state.initialized) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMetricsRegistry } = require('./registry') as { getMetricsRegistry: () => client.Registry };

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

  return state.dbQueryDurationSeconds!;
}

export function ensureDbMetricsInitialized(): void {
  void getDbQueryDurationSecondsHistogram();
}

export function observeDbQueryDurationSeconds(queryName: string, durationSeconds: number): void {
  getDbQueryDurationSecondsHistogram().labels(queryName).observe(durationSeconds);
}

export default {
  METRIC_NAME,
  ensureDbMetricsInitialized,
  getDbQueryDurationSecondsHistogram,
  observeDbQueryDurationSeconds,
};

