import { Router } from 'express';

import { getEnv } from '../config/env';
import { IMAGE_STATUS_ACTIVE, IMAGE_STATUS_BROKEN, IMAGE_STATUS_DISABLED, getByIdWithTags, listImagesWithTags, type PickRandomFilters } from '../repositories/imagesRepo';

const router = Router();

function parsePositiveInteger(value: unknown): bigint {
  const raw = typeof value === 'string' ? value : String(value);
  if (!/^([1-9][0-9]*)$/.test(raw)) {
    const err = new Error('Invalid id.');
    (err as any).status = 400;
    (err as any).code = 'INVALID_ID';
    throw err;
  }
  return BigInt(raw);
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) return 50;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();

  if (!normalized || !/^\d+$/.test(normalized)) {
    const err = new Error('Invalid limit.');
    (err as any).status = 400;
    throw err;
  }

  const n = Number(normalized);
  if (!Number.isSafeInteger(n) || n < 1 || n > 200) {
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

  if (id < 1n || id > PG_BIGINT_MAX) {
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

function normalizeStatus(status: number): 'active' | 'disabled' | 'broken' {
  if (status === IMAGE_STATUS_ACTIVE) return 'active';
  if (status === IMAGE_STATUS_DISABLED) return 'disabled';
  if (status === IMAGE_STATUS_BROKEN) return 'broken';
  return 'broken';
}

function parseR18(value: unknown): number {
  if (value === undefined || value === null) return 0;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim().toLowerCase();

  if (!normalized) {
    const err = new Error('Invalid r18.');
    (err as any).status = 400;
    throw err;
  }

  if (normalized === '0' || normalized === '1' || normalized === '2') {
    return Number(normalized);
  }

  const err = new Error('Invalid r18.');
  (err as any).status = 400;
  throw err;
}

function parseR18Strict(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim().toLowerCase();

  if (!normalized) {
    const err = new Error('Invalid r18_strict.');
    (err as any).status = 400;
    throw err;
  }

  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;

  const err = new Error('Invalid r18_strict.');
  (err as any).status = 400;
  throw err;
}

function parseOrientation(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim().toLowerCase();

  if (!normalized) {
    const err = new Error('Invalid orientation.');
    (err as any).status = 400;
    throw err;
  }

  if (normalized === 'any') return undefined;
  if (normalized === 'portrait') return 1;
  if (normalized === 'landscape') return 2;
  if (normalized === 'square') return 3;

  const err = new Error('Invalid orientation.');
  (err as any).status = 400;
  throw err;
}

function parseMinInt(value: unknown, errorMessage: string): number | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();

  if (!normalized || !/^\d+$/.test(normalized)) {
    const err = new Error(errorMessage);
    (err as any).status = 400;
    throw err;
  }

  const n = Number(normalized);
  if (!Number.isSafeInteger(n) || n < 0) {
    const err = new Error(errorMessage);
    (err as any).status = 400;
    throw err;
  }

  return n;
}

function parseIncludedTags(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();

  if (!normalized) {
    const err = new Error('Invalid included_tags.');
    (err as any).status = 400;
    throw err;
  }

  const tags = normalized
    .split('|')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');

  if (tags.length === 0) {
    const err = new Error('Invalid included_tags.');
    (err as any).status = 400;
    throw err;
  }

  return [...new Set(tags)];
}

function parseExcludedTags(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();

  if (!normalized) {
    const err = new Error('Invalid excluded_tags.');
    (err as any).status = 400;
    throw err;
  }

  const tags = normalized
    .split('|')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');

  if (tags.length === 0) {
    const err = new Error('Invalid excluded_tags.');
    (err as any).status = 400;
    throw err;
  }

  return [...new Set(tags)];
}

function parseUserId(value: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();

  if (!normalized || !/^\d+$/.test(normalized)) {
    const err = new Error('Invalid user_id.');
    (err as any).status = 400;
    throw err;
  }

  let id: bigint;
  try {
    id = BigInt(normalized);
  } catch {
    const err = new Error('Invalid user_id.');
    (err as any).status = 400;
    throw err;
  }

  if (id < 1n || id > PG_BIGINT_MAX) {
    const err = new Error('Invalid user_id.');
    (err as any).status = 400;
    throw err;
  }

  return id;
}

function parseIllustId(value: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();

  if (!normalized || !/^\d+$/.test(normalized)) {
    const err = new Error('Invalid illust_id.');
    (err as any).status = 400;
    throw err;
  }

  let id: bigint;
  try {
    id = BigInt(normalized);
  } catch {
    const err = new Error('Invalid illust_id.');
    (err as any).status = 400;
    throw err;
  }

  if (id < 1n || id > PG_BIGINT_MAX) {
    const err = new Error('Invalid illust_id.');
    (err as any).status = 400;
    throw err;
  }

  return id;
}

router.get('/', (req, res, next) => {
  (async () => {
    res.setHeader('Cache-Control', 'no-store');

    const env = getEnv();

    const limit = parseLimit((req.query as any).limit);
    const cursor = parseCursor((req.query as any).cursor);

    const xRestrict = parseR18((req.query as any).r18);
    const strictParam = parseR18Strict((req.query as any).r18_strict ?? (req.query as any).r18Strict);
    const r18Strict = strictParam ?? env.RANDOM_R18_STRICT;

    const orientation = parseOrientation((req.query as any).orientation);
    const minWidth = parseMinInt((req.query as any).min_width, 'Invalid min_width.');
    const minHeight = parseMinInt((req.query as any).min_height, 'Invalid min_height.');
    const minPixels = parseMinInt((req.query as any).min_pixels, 'Invalid min_pixels.');
    const includedTags = parseIncludedTags((req.query as any).included_tags);
    const excludedTags = parseExcludedTags((req.query as any).excluded_tags);
    const userId = parseUserId((req.query as any).user_id);
    const illustId = parseIllustId((req.query as any).illust_id);

    const filters: PickRandomFilters = {};
    filters.xRestrict = xRestrict;
    if (xRestrict === 0 && r18Strict) filters.xRestrictAllowUnknown = false;
    if (orientation !== undefined) filters.orientation = orientation;
    if (minWidth !== undefined) filters.minWidth = minWidth;
    if (minHeight !== undefined) filters.minHeight = minHeight;
    if (minPixels !== undefined) filters.minPixels = minPixels;
    if (includedTags !== undefined) filters.includedTags = includedTags;
    if (excludedTags !== undefined) filters.excludedTags = excludedTags;
    if (userId !== undefined) filters.userId = userId;
    if (illustId !== undefined) filters.illustId = illustId;

    const result = await listImagesWithTags(filters, { limit, cursor });

    res.json({
      items: result.items.map((image: any) => ({
        id: bigintToSafeNumber(image.id, 'IMAGE_ID_OUT_OF_RANGE'),
        illust_id: bigintToSafeNumber(image.illustId, 'ILLUST_ID_OUT_OF_RANGE'),
        page_index: image.pageIndex,
        ext: image.ext,
        width: image.width ?? null,
        height: image.height ?? null,
        x_restrict: image.xRestrict ?? null,
        user_id: image.userId !== null && image.userId !== undefined ? bigintToSafeNumber(image.userId, 'USER_ID_OUT_OF_RANGE') : null,
        user_name: image.userName ?? null,
        status: normalizeStatus(image.status),
        tags: (image.imageTags || []).map((row: any) => row?.tag?.name).filter((name: any) => typeof name === 'string'),
      })),
      next_cursor: result.nextCursor ? result.nextCursor.toString() : null,
    });
  })().catch(next);
});

router.get('/:id', (req, res, next) => {
  (async () => {
    const id = parsePositiveInteger((req.params as any).id);

    const image = await getByIdWithTags(id);
    if (!image) {
      const err = new Error('Not Found');
      (err as any).status = 404;
      (err as any).code = 'NOT_FOUND';
      throw err;
    }

    const tags = (image.imageTags || []).map((row: any) => row.tag.name);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      id: bigintToSafeNumber(image.id, 'IMAGE_ID_OUT_OF_RANGE'),
      illust_id: bigintToSafeNumber(image.illustId, 'ILLUST_ID_OUT_OF_RANGE'),
      page_index: image.pageIndex,
      ext: image.ext,
      width: image.width ?? null,
      height: image.height ?? null,
      x_restrict: image.xRestrict ?? null,
      user_id: image.userId !== null && image.userId !== undefined ? bigintToSafeNumber(image.userId, 'USER_ID_OUT_OF_RANGE') : null,
      user_name: image.userName ?? null,
      status: normalizeStatus(image.status),
      tags,
      fail_count: image.failCount,
      last_fail_at: image.lastFailAt ?? null,
    });
  })().catch(next);
});

export default router;
