import client from 'prom-client';

const METRIC_NAME = 'classification_requests_total';

type ClassificationMetricsState = {
  initialized: boolean;
  classificationRequestsTotal: client.Counter<'endpoint' | 'status'> | null;
};

function ensureClassificationMetricsState(): ClassificationMetricsState {
  // eslint-disable-next-line no-underscore-dangle
  (globalThis as any).__pixivcatClassificationMetrics ??= {
    initialized: false,
    classificationRequestsTotal: null,
  } satisfies ClassificationMetricsState;

  // eslint-disable-next-line no-underscore-dangle
  return (globalThis as any).__pixivcatClassificationMetrics as ClassificationMetricsState;
}

export function getClassificationRequestsTotalCounter(): client.Counter<'endpoint' | 'status'> {
  const state = ensureClassificationMetricsState();

  if (!state.initialized) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMetricsRegistry } = require('./registry') as { getMetricsRegistry: () => client.Registry };
    const registry = getMetricsRegistry();

    state.classificationRequestsTotal = new client.Counter({
      name: METRIC_NAME,
      help: 'Total classification API requests by endpoint and status.',
      labelNames: ['endpoint', 'status'],
      registers: [registry],
    });
    state.initialized = true;
  }

  return state.classificationRequestsTotal!;
}

export function ensureClassificationMetricsInitialized(): void {
  void getClassificationRequestsTotalCounter();
}

export function incClassificationRequest(endpoint: string, status: 'success' | 'error'): void {
  const counter = getClassificationRequestsTotalCounter();
  counter.labels(endpoint, status).inc();
}

export default {
  METRIC_NAME,
  ensureClassificationMetricsInitialized,
  getClassificationRequestsTotalCounter,
  incClassificationRequest,
};
