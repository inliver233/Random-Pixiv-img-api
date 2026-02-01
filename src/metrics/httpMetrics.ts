import type { Request, Response } from 'express';
import client from 'prom-client';

const METRIC_NAME = 'http_requests_total';

type HttpMetricsState = {
  initialized: boolean;
  requestsTotal: client.Counter<'method' | 'route' | 'status'> | null;
};

function ensureHttpMetricsState(): HttpMetricsState {
  // eslint-disable-next-line no-underscore-dangle
  (globalThis as any).__pixivcatHttpMetrics ??= {
    initialized: false,
    requestsTotal: null,
  } satisfies HttpMetricsState;

  // eslint-disable-next-line no-underscore-dangle
  return (globalThis as any).__pixivcatHttpMetrics as HttpMetricsState;
}

export function getHttpRouteLabel(req: Request): string {
  const maybeRoute = (req as any).route;
  if (maybeRoute?.path) {
    const baseUrl = String(req.baseUrl || '');
    const routePath = Array.isArray(maybeRoute.path) ? maybeRoute.path.join('|') : String(maybeRoute.path);
    return `${baseUrl}${routePath}`;
  }

  return 'unmatched';
}

export function getHttpRequestsTotalCounter(): client.Counter<'method' | 'route' | 'status'> {
  const state = ensureHttpMetricsState();

  if (!state.initialized) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMetricsRegistry } = require('./registry') as { getMetricsRegistry: () => client.Registry };

    const registry = getMetricsRegistry();
    state.requestsTotal = new client.Counter({
      name: METRIC_NAME,
      help: 'Total number of HTTP requests.',
      labelNames: ['method', 'route', 'status'],
      registers: [registry],
    });
    state.initialized = true;
  }

  return state.requestsTotal!;
}

export function ensureHttpMetricsInitialized(): void {
  void getHttpRequestsTotalCounter();
}

export function incrementHttpRequestsTotal(req: Request, res: Response): void {
  const counter = getHttpRequestsTotalCounter();
  counter.labels(req.method, getHttpRouteLabel(req), String(res.statusCode)).inc();
}

export default {
  METRIC_NAME,
  ensureHttpMetricsInitialized,
  getHttpRouteLabel,
  getHttpRequestsTotalCounter,
  incrementHttpRequestsTotal,
};

