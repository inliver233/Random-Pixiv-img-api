const client = require('prom-client');
const { getMetricsRegistry } = require('./registry');

const METRIC_NAME = 'http_requests_total';

const ensureHttpMetricsState = () => {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatHttpMetrics ??= {
    initialized: false,
    requestsTotal: null,
  };

  // eslint-disable-next-line no-underscore-dangle
  return globalThis.__pixivcatHttpMetrics;
};

function getHttpRouteLabel(req) {
  if (req && req.route && req.route.path) {
    const baseUrl = String(req.baseUrl || '');
    const routePath = Array.isArray(req.route.path) ? req.route.path.join('|') : String(req.route.path);
    return `${baseUrl}${routePath}`;
  }

  return 'unmatched';
}

function getHttpRequestsTotalCounter() {
  const state = ensureHttpMetricsState();

  if (!state.initialized) {
    const registry = getMetricsRegistry();
    state.requestsTotal = new client.Counter({
      name: METRIC_NAME,
      help: 'Total number of HTTP requests.',
      labelNames: ['method', 'route', 'status'],
      registers: [registry],
    });
    state.initialized = true;
  }

  return state.requestsTotal;
}

function ensureHttpMetricsInitialized() {
  void getHttpRequestsTotalCounter();
}

function incrementHttpRequestsTotal(req, res) {
  const counter = getHttpRequestsTotalCounter();
  counter
    .labels(String(req.method || 'UNKNOWN'), getHttpRouteLabel(req), String(res.statusCode || 0))
    .inc();
}

module.exports = {
  METRIC_NAME,
  ensureHttpMetricsInitialized,
  getHttpRouteLabel,
  getHttpRequestsTotalCounter,
  incrementHttpRequestsTotal,
};

