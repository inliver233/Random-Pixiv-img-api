const express = require('express');
const { checkDb } = require('../db/dbHealth');
const memcachedService = require('../services/memcachedService');

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

function sanitizeHealthMessage(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  return raw
    .replace(/(postgres(?:ql)?:\/\/)([^@\s:/]+):([^@\s]+)@/gi, '$1***:***@')
    .replace(/(https?:\/\/)([^@\s:/]+):([^@\s]+)@/gi, '$1***:***@')
    .replace(/(password=)[^\s;]+/gi, '$1***');
}

const withTimeout = (promise, timeoutMs, timeoutMessage) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);

router.get('/', (req, res) => {
  (async () => {
    res.setHeader('Cache-Control', 'no-store');
    const requestId = getRequestId(req, res);

    const dbRaw = await checkDb();
    const db = {
      ok: Boolean(dbRaw?.ok),
      message: sanitizeHealthMessage(dbRaw?.message),
    };

    let memcached;
    try {
      await withTimeout(memcachedService.get('__healthz__'), 500, 'memcached timeout');
      memcached = { ok: true, message: null };
    } catch (err) {
      memcached = { ok: false, message: sanitizeHealthMessage(err?.message || String(err)) };
    }

    const queue = { ok: true, message: 'not_initialized' };

    const ok = Boolean(db.ok && memcached.ok && queue.ok);
    const body = { ok, db, memcached, queue };
    if (!ok) {
      body.code = 'DEPENDENCY_UNAVAILABLE';
      body.message = 'One or more dependencies are unavailable.';
    }
    if (requestId) body.request_id = requestId;
    res.status(ok ? 200 : 503).json(body);
  })().catch((err) => {
    const requestId = getRequestId(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({
      ok: false,
      code: 'HEALTHZ_FAILED',
      message: 'Health check execution failed.',
      db: { ok: false, message: 'healthz error' },
      memcached: { ok: false, message: 'healthz error' },
      queue: { ok: false, message: 'healthz error' },
      ...(requestId ? { request_id: requestId } : {}),
      error: sanitizeHealthMessage(err?.message || String(err)),
    });
  });
});

module.exports = router;
