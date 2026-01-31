const express = require('express');
const { checkDb } = require('../db/dbHealth');
const memcachedService = require('../services/memcachedService');

const router = express.Router();

const withTimeout = (promise, timeoutMs, timeoutMessage) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);

router.get('/', (req, res) => {
  (async () => {
    const db = await checkDb();

    let memcached;
    try {
      await withTimeout(memcachedService.get('__healthz__'), 500, 'memcached timeout');
      memcached = { ok: true, message: null };
    } catch (err) {
      memcached = { ok: false, message: err?.message || String(err) };
    }

    const queue = { ok: true, message: 'not_initialized' };

    const ok = Boolean(db.ok && memcached.ok && queue.ok);

    res.status(ok ? 200 : 503).json({ ok, db, memcached, queue });
  })().catch((err) => {
    res.status(503).json({
      ok: false,
      db: { ok: false, message: 'healthz error' },
      memcached: { ok: false, message: 'healthz error' },
      queue: { ok: false, message: 'healthz error' },
      error: err?.message || String(err),
    });
  });
});

module.exports = router;
