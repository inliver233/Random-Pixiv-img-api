import { Router } from 'express';

import { getBuildInfo } from '../utils/buildInfo';

const router = Router();

function getRequestId(
  req: { request_id?: unknown; headers?: Record<string, unknown> },
  res: { locals?: Record<string, unknown> },
): string | undefined {
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

function sanitizeHealthMessage(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  return raw
    .replace(/(postgres(?:ql)?:\/\/)([^@\s:/]+):([^@\s]+)@/gi, '$1***:***@')
    .replace(/(https?:\/\/)([^@\s:/]+):([^@\s]+)@/gi, '$1***:***@')
    .replace(/(password=)[^\s;]+/gi, '$1***');
}

router.get('/', (req, res) => {
  (async () => {
    res.setHeader('Cache-Control', 'no-store');
    const requestId = getRequestId(req as any, res as any);
    // Use the JS db health checker so both app.js (CJS) and app.ts (TS build) share behavior.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkDb } = require('../db/dbHealth') as { checkDb: () => Promise<{ ok: boolean; message?: string | null }> };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const memcachedService = require('../services/memcachedService').default as { get: (key: string) => Promise<unknown> };

    const dbRaw = await checkDb();
    const db = {
      ok: Boolean(dbRaw?.ok),
      message: sanitizeHealthMessage(dbRaw?.message),
    };

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
      memcached = { ok: false, message: sanitizeHealthMessage(err instanceof Error ? err.message : String(err)) };
    }

    let queue: { ok: boolean; message: string | null };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getQueueHealth } = require('../queue/queue') as { getQueueHealth: () => Promise<{ ok: boolean; message: string | null }> };
      const queueRaw = await withTimeout(getQueueHealth(), 500, 'queue timeout');
      queue = {
        ok: Boolean(queueRaw?.ok),
        message: sanitizeHealthMessage(queueRaw?.message),
      };
    } catch (err: unknown) {
      queue = { ok: false, message: sanitizeHealthMessage(err instanceof Error ? err.message : String(err)) };
    }

    const ok = Boolean(db.ok && memcached.ok && queue.ok);
    const body: Record<string, unknown> = { ok, db, memcached, queue, build: getBuildInfo() };
    if (!ok) {
      body.code = 'DEPENDENCY_UNAVAILABLE';
      body.message = 'One or more dependencies are unavailable.';
    }
    if (requestId) body.request_id = requestId;
    res.status(ok ? 200 : 503).json(body);
  })().catch((err: unknown) => {
    const requestId = getRequestId(req as any, res as any);
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({
      ok: false,
      code: 'HEALTHZ_FAILED',
      message: 'Health check execution failed.',
      db: { ok: false, message: 'healthz error' },
      memcached: { ok: false, message: 'healthz error' },
      queue: { ok: false, message: 'healthz error' },
      ...(requestId ? { request_id: requestId } : {}),
      error: sanitizeHealthMessage(err instanceof Error ? err.message : String(err)),
    });
  });
});

export default router;
