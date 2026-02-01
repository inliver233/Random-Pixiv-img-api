const express = require('express');
const { getEnv } = require('../config/env');
const { getMetricsRegistry } = require('../metrics/registry');
const { ensureHttpMetricsInitialized } = require('../metrics/httpMetrics');

const router = express.Router();

function needsBasicAuth() {
  return Boolean(process.env.METRICS_BASIC_AUTH_USER && process.env.METRICS_BASIC_AUTH_PASS);
}

function checkBasicAuth(req) {
  const user = process.env.METRICS_BASIC_AUTH_USER;
  const pass = process.env.METRICS_BASIC_AUTH_PASS;
  if (!user || !pass) return true;

  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const sepIndex = decoded.indexOf(':');
  if (sepIndex < 0) return false;

  const providedUser = decoded.slice(0, sepIndex);
  const providedPass = decoded.slice(sepIndex + 1);
  return providedUser === user && providedPass === pass;
}

router.get('/', async (req, res) => {
  const env = getEnv();
  if (!env.METRICS_ENABLED) {
    res.status(404).json({ error: 'metrics_disabled' });
    return;
  }

  if (needsBasicAuth() && !checkBasicAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm=\"metrics\"');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  ensureHttpMetricsInitialized();

  const registry = getMetricsRegistry();
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

module.exports = router;
