import { Router } from 'express';

import { searchAuthors } from '../repositories/authorsRepo';

const router = Router();

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) return 20;
  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();
  if (!normalized || !/^\d+$/.test(normalized)) {
    const err = new Error('Invalid limit.');
    (err as any).status = 400;
    throw err;
  }
  const n = Number(normalized);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100) {
    const err = new Error('Invalid limit.');
    (err as any).status = 400;
    throw err;
  }
  return n;
}

const PG_BIGINT_MAX = 9223372036854775807n;

function parseCursor(value: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();
  if (!normalized || !/^\d+$/.test(normalized)) {
    const err = new Error('Invalid cursor.');
    (err as any).status = 400;
    throw err;
  }

  let id: bigint;
  try {
    id = BigInt(normalized);
  } catch {
    const err = new Error('Invalid cursor.');
    (err as any).status = 400;
    throw err;
  }

  if (id < 0n || id > PG_BIGINT_MAX) {
    const err = new Error('Invalid cursor.');
    (err as any).status = 400;
    throw err;
  }

  return id;
}

function bigintToSafeNumber(value: bigint, code: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    const err = new Error('Integer out of safe range.');
    (err as any).status = 500;
    (err as any).code = code;
    throw err;
  }
  return n;
}

router.get('/', (req, res, next) => {
  (async () => {
    res.setHeader('Cache-Control', 'no-store');

    const qRaw = (req.query as any).q;
    const q = typeof qRaw === 'string' ? qRaw : Array.isArray(qRaw) ? String(qRaw[0] || '') : undefined;
    const limit = parseLimit((req.query as any).limit);
    const cursor = parseCursor((req.query as any).cursor);

    const result = await searchAuthors({ q, limit, cursor });

    res.json({
      items: result.items.map((item) => ({
        user_id: bigintToSafeNumber(item.userId, 'USER_ID_OUT_OF_RANGE'),
        user_name: item.userName,
        image_count: item.imageCount,
      })),
      next_cursor: result.nextCursor ? result.nextCursor.toString() : null,
    });
  })().catch(next);
});

export default router;

