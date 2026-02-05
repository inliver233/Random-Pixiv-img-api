import client from 'prom-client';

const METRIC_NAME = 'outbound_errors_total';

type OutboundMetricsState = {
  initialized: boolean;
  outboundErrorsTotal: client.Counter<'type'> | null;
};

function ensureOutboundMetricsState(): OutboundMetricsState {
  // eslint-disable-next-line no-underscore-dangle
  (globalThis as any).__pixivcatOutboundMetrics ??= {
    initialized: false,
    outboundErrorsTotal: null,
  } satisfies OutboundMetricsState;

  // eslint-disable-next-line no-underscore-dangle
  return (globalThis as any).__pixivcatOutboundMetrics as OutboundMetricsState;
}

export function getOutboundErrorsTotalCounter(): client.Counter<'type'> {
  const state = ensureOutboundMetricsState();

  if (!state.initialized) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMetricsRegistry } = require('./registry') as { getMetricsRegistry: () => client.Registry };

    const registry = getMetricsRegistry();
    state.outboundErrorsTotal = new client.Counter({
      name: METRIC_NAME,
      help: 'Total number of outbound errors classified by type.',
      labelNames: ['type'],
      registers: [registry],
    });
    state.initialized = true;
  }

  return state.outboundErrorsTotal!;
}

export function ensureOutboundMetricsInitialized(): void {
  void getOutboundErrorsTotalCounter();
}

export function incrementOutboundError(type: string): void {
  getOutboundErrorsTotalCounter().labels(String(type)).inc();
}

export default {
  METRIC_NAME,
  ensureOutboundMetricsInitialized,
  getOutboundErrorsTotalCounter,
  incrementOutboundError,
};

