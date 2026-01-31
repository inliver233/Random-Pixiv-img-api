import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  (async () => {
    // Use the JS db health checker so both app.js (CJS) and app.ts (TS build) share behavior.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkDb } = require('../db/dbHealth') as { checkDb: () => Promise<{ ok: boolean; message?: string | null }> };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const memcachedService = require('../services/memcachedService').default as { get: (key: string) => Promise<unknown> };

    const db = await checkDb();

    const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        }),
      ]);

    let memcached: { ok: boolean; message: string | null };
    try {
      await withTimeout(memcachedService.get('__healthz__'), 500, 'memcached timeout');
      memcached = { ok: true, message: null };
    } catch (err: unknown) {
      memcached = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }

    const queue = { ok: true, message: 'not_initialized' };

    const ok = Boolean(db.ok && memcached.ok && queue.ok);

    res.status(ok ? 200 : 503).json({ ok, db, memcached, queue });
  })().catch((err: unknown) => {
    res.status(503).json({
      ok: false,
      db: { ok: false, message: 'healthz error' },
      memcached: { ok: false, message: 'healthz error' },
      queue: { ok: false, message: 'healthz error' },
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

export default router;
