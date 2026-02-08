const express = require('express');
const { getEnv } = require('../config/env');
const { getMetricsRegistry } = require('../metrics/registry');
const { ensureHttpMetricsInitialized } = require('../metrics/httpMetrics');
const { ensureRandomMetricsInitialized } = require('../metrics/randomMetrics');
const { ensureUpstreamMetricsInitialized } = require('../metrics/upstreamMetrics');
const { ensureOutboundMetricsInitialized } = require('../metrics/outboundMetrics');
const { ensureDbMetricsInitialized } = require('../metrics/dbMetrics');
const { ensureJobMetricsInitialized } = require('../metrics/jobMetrics');
const { ensureClassificationMetricsInitialized } = require('../metrics/classificationMetrics');

const router = express.Router();

function getRequestId(req, res) {
  const fromReq = typeof req.request_id === 'string' && req.request_id.trim() ? req.request_id.trim() : undefined;
  if (fromReq) return fromReq;
  const headerValue = req.headers?.['x-request-id'];
  if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  if (Array.isArray(headerValue)) {
    const first = headerValue.find((item) => typeof item === 'string' && item.trim());
    if (typeof first === 'string' && first.trim()) return first.trim();
  }
  const fromRes = typeof res.locals?.request_id === 'string' && String(res.locals.request_id).trim()
    ? String(res.locals.request_id).trim()
    : undefined;
  return fromRes;
}

function sendJsonError(res, params) {
  const body = {
    code: params.code,
    message: params.message,
  };
  if (params.requestId) body.request_id = params.requestId;
  return res.status(params.status).json(body);
}

function checkBasicAuth(req, params) {
  const auth = req.headers.authorization;
  const header = Array.isArray(auth) ? String(auth[0] || '') : String(auth || '');
  if (!header.startsWith('Basic ')) return false;

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const sepIndex = decoded.indexOf(':');
  if (sepIndex < 0) return false;

  const providedUser = decoded.slice(0, sepIndex);
  const providedPass = decoded.slice(sepIndex + 1);
  return providedUser === params.user && providedPass === params.pass;
}

router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const requestId = getRequestId(req, res);

  const env = getEnv();
  if (!env.METRICS_ENABLED) {
    sendJsonError(res, {
      status: 404,
      code: 'METRICS_DISABLED',
      message: 'Metrics endpoint is disabled.',
      requestId,
    });
    return;
  }

  const authUser = env.METRICS_BASIC_AUTH_USER;
  const authPass = env.METRICS_BASIC_AUTH_PASS;

  if (authUser && authPass) {
    if (!checkBasicAuth(req, { user: authUser, pass: authPass })) {
      res.setHeader('WWW-Authenticate', 'Basic realm="metrics"');
      sendJsonError(res, {
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Unauthorized.',
        requestId,
      });
      return;
    }
  } else if (!env.METRICS_ALLOW_UNAUTHENTICATED) {
    sendJsonError(res, {
      status: 404,
      code: 'METRICS_PROTECTED',
      message: 'Metrics endpoint is protected. Configure Basic Auth or disable metrics.',
      requestId,
    });
    return;
  }

  ensureHttpMetricsInitialized();
  ensureRandomMetricsInitialized();
  ensureUpstreamMetricsInitialized();
  ensureOutboundMetricsInitialized();
  ensureDbMetricsInitialized();
  ensureJobMetricsInitialized();
  ensureClassificationMetricsInitialized();

  try {
    const registry = getMetricsRegistry();
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  } catch {
    sendJsonError(res, {
      status: 503,
      code: 'METRICS_UNAVAILABLE',
      message: 'Metrics registry is temporarily unavailable.',
      requestId,
    });
  }
});

module.exports = router;
