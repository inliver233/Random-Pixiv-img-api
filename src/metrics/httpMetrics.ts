import type { Request, Response } from 'express';
import client from 'prom-client';

const METRIC_NAME = 'http_requests_total';
const DURATION_METRIC_NAME = 'request_duration_seconds';

type HttpMetricsState = {
  initialized: boolean;
  requestsTotal: client.Counter<'method' | 'route' | 'status'> | null;
  requestDurationSeconds: client.Histogram<'route' | 'status'> | null;
};

function ensureHttpMetricsState(): HttpMetricsState {
  // eslint-disable-next-line no-underscore-dangle
  (globalThis as any).__pixivcatHttpMetrics ??= {
    initialized: false,
    requestsTotal: null,
    requestDurationSeconds: null,
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
    state.requestDurationSeconds = new client.Histogram({
      name: DURATION_METRIC_NAME,
      help: 'HTTP request duration in seconds.',
      labelNames: ['route', 'status'],
      registers: [registry],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
    });
    state.initialized = true;
  }

  return state.requestsTotal!;
}

export function ensureHttpMetricsInitialized(): void {
  void getHttpRequestsTotalCounter();
}

export function observeRequestDurationSeconds(req: Request, res: Response, durationSeconds: number): void {
  const state = ensureHttpMetricsState();
  if (!state.initialized) void getHttpRequestsTotalCounter();

  state.requestDurationSeconds!.labels(getHttpRouteLabel(req), String(res.statusCode)).observe(durationSeconds);
}

export function incrementHttpRequestsTotal(req: Request, res: Response): void {
  const counter = getHttpRequestsTotalCounter();
  counter.labels(req.method, getHttpRouteLabel(req), String(res.statusCode)).inc();
}

export default {
  METRIC_NAME,
  DURATION_METRIC_NAME,
  ensureHttpMetricsInitialized,
  getHttpRouteLabel,
  getHttpRequestsTotalCounter,
  observeRequestDurationSeconds,
  incrementHttpRequestsTotal,
};
