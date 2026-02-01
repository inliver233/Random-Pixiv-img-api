import client from 'prom-client';

const METRIC_NAME = 'upstream_errors_total';

type UpstreamMetricsState = {
  initialized: boolean;
  upstreamErrorsTotal: client.Counter<'type'> | null;
};

function ensureUpstreamMetricsState(): UpstreamMetricsState {
  // eslint-disable-next-line no-underscore-dangle
  (globalThis as any).__pixivcatUpstreamMetrics ??= {
    initialized: false,
    upstreamErrorsTotal: null,
  } satisfies UpstreamMetricsState;

  // eslint-disable-next-line no-underscore-dangle
  return (globalThis as any).__pixivcatUpstreamMetrics as UpstreamMetricsState;
}

export function getUpstreamErrorsTotalCounter(): client.Counter<'type'> {
  const state = ensureUpstreamMetricsState();

  if (!state.initialized) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMetricsRegistry } = require('./registry') as { getMetricsRegistry: () => client.Registry };

    const registry = getMetricsRegistry();
    state.upstreamErrorsTotal = new client.Counter({
      name: METRIC_NAME,
      help: 'Total number of upstream errors.',
      labelNames: ['type'],
      registers: [registry],
    });
    state.initialized = true;
  }

  return state.upstreamErrorsTotal!;
}

export function ensureUpstreamMetricsInitialized(): void {
  void getUpstreamErrorsTotalCounter();
}

export function incrementUpstreamError(type: string): void {
  getUpstreamErrorsTotalCounter().labels(type).inc();
}

export default {
  METRIC_NAME,
  ensureUpstreamMetricsInitialized,
  getUpstreamErrorsTotalCounter,
  incrementUpstreamError,
};

