import { Router } from 'express';

const router = Router();

function needsBasicAuth(): boolean {
  return Boolean(process.env.METRICS_BASIC_AUTH_USER && process.env.METRICS_BASIC_AUTH_PASS);
}

function checkBasicAuth(req: { headers: { authorization?: string | string[] } }): boolean {
  const user = process.env.METRICS_BASIC_AUTH_USER;
  const pass = process.env.METRICS_BASIC_AUTH_PASS;
  if (!user || !pass) return true;

  const auth = req.headers.authorization;
  const header = Array.isArray(auth) ? auth[0] : String(auth || '');
  if (!header.startsWith('Basic ')) return false;

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const sepIndex = decoded.indexOf(':');
  if (sepIndex < 0) return false;

  const providedUser = decoded.slice(0, sepIndex);
  const providedPass = decoded.slice(sepIndex + 1);
  return providedUser === user && providedPass === pass;
}

router.get('/', async (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getEnv } = require('../config/env') as { getEnv: () => { METRICS_ENABLED: boolean } };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getMetricsRegistry } = require('../metrics/registry') as { getMetricsRegistry: () => { contentType: string; metrics: () => Promise<string> } };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ensureHttpMetricsInitialized } = require('../metrics/httpMetrics') as { ensureHttpMetricsInitialized: () => void };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ensureRandomMetricsInitialized } = require('../metrics/randomMetrics') as { ensureRandomMetricsInitialized: () => void };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ensureUpstreamMetricsInitialized } = require('../metrics/upstreamMetrics') as { ensureUpstreamMetricsInitialized: () => void };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ensureDbMetricsInitialized } = require('../metrics/dbMetrics') as { ensureDbMetricsInitialized: () => void };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ensureJobMetricsInitialized } = require('../metrics/jobMetrics') as { ensureJobMetricsInitialized: () => void };

  const env = getEnv();
  if (!env.METRICS_ENABLED) {
    res.status(404).json({ error: 'metrics_disabled' });
    return;
  }

  if (needsBasicAuth() && !checkBasicAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="metrics"');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  ensureHttpMetricsInitialized();
  ensureRandomMetricsInitialized();
  ensureUpstreamMetricsInitialized();
  ensureDbMetricsInitialized();
  ensureJobMetricsInitialized();

  const registry = getMetricsRegistry();
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

export default router;
