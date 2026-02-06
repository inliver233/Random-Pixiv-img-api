import { Router } from 'express';
import type { Readable } from 'node:stream';

import { getEnv } from '../config/env';
import { buildRandomJsonResponse } from '../contracts/randomResponse';
import { buildSignedImgproxyUrl } from '../imgproxy/imgproxy';
import { incrementRandomFailTotal, incrementRandomSuccessTotal, observeRandomAttemptsHistogram } from '../metrics/randomMetrics';
import { getImageContentTypeFromFilename } from '../utils/contentType';
import { pickRandomImageRecord, pickRandomImageStream } from '../services/randomService';
import { IMAGE_STATUS_BROKEN, markFail } from '../repositories/imagesRepo';
import { isOpportunisticHydrateCandidate, scheduleOpportunisticHydrate } from '../hydration/opportunisticHydrate';

const router = Router();

function parseFormat(value: unknown): 'image' | 'json' {
  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim().toLowerCase();

  if (!normalized || normalized === 'image') return 'image';
  if (normalized === 'json') return 'json';

  const err = new Error('Invalid format.');
  (err as any).status = 400;
  throw err;
}

function parseRedirect(value: unknown): boolean {
  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();

  if (!normalized || normalized === '0') return false;
  if (normalized === '1') return true;

  const err = new Error('Invalid redirect.');
  (err as any).status = 400;
  throw err;
}

const DEFAULT_ATTEMPTS = 3;

function parseAttempts(value: unknown): number {
  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();
  if (!normalized) return DEFAULT_ATTEMPTS;

  if (!/^\d+$/.test(normalized)) {
    const err = new Error('Invalid attempts.');
    (err as any).status = 400;
    throw err;
  }

  const n = Number(normalized);
  if (!Number.isSafeInteger(n)) {
    const err = new Error('Invalid attempts.');
    (err as any).status = 400;
    throw err;
  }

  return Math.max(1, Math.min(10, n));
}

function parseSeed(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();
  if (!normalized) {
    const err = new Error('Invalid seed.');
    (err as any).status = 400;
    throw err;
  }

  return normalized;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;

  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
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

function parseMinWidth(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();

  if (!normalized || !/^\d+$/.test(normalized)) {
    const err = new Error('Invalid min_width.');
    (err as any).status = 400;
    throw err;
  }

  const n = Number(normalized);
  if (!Number.isSafeInteger(n) || n < 0) {
    const err = new Error('Invalid min_width.');
    (err as any).status = 400;
    throw err;
  }

  return n;
}

function parseMinHeight(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();

  if (!normalized || !/^\d+$/.test(normalized)) {
    const err = new Error('Invalid min_height.');
    (err as any).status = 400;
    throw err;
  }

  const n = Number(normalized);
  if (!Number.isSafeInteger(n) || n < 0) {
    const err = new Error('Invalid min_height.');
    (err as any).status = 400;
    throw err;
  }

  return n;
}

function parseMinPixels(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim();

  if (!normalized || !/^\d+$/.test(normalized)) {
    const err = new Error('Invalid min_pixels.');
    (err as any).status = 400;
    throw err;
  }

  const n = Number(normalized);
  if (!Number.isSafeInteger(n) || n < 0) {
    const err = new Error('Invalid min_pixels.');
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

const PG_BIGINT_MAX = 9223372036854775807n;

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

function normalizeFilterValueForJson(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => normalizeFilterValueForJson(item));
  return value;
}

function buildNoMatchHints(filters: Record<string, unknown>): {
  applied_filters: Record<string, unknown>;
  suggestions: string[];
} {
  const appliedFilters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    appliedFilters[key] = normalizeFilterValueForJson(value);
  }

  const suggestions: string[] = [];
  if (filters.orientation !== undefined) suggestions.push('remove orientation filter');
  if (filters.minWidth !== undefined || filters.minHeight !== undefined || filters.minPixels !== undefined) {
    suggestions.push('lower min_width/min_height/min_pixels');
  }
  if (filters.includedTags !== undefined) suggestions.push('relax included_tags');
  if (filters.excludedTags !== undefined) suggestions.push('remove excluded_tags');
  if (filters.userId !== undefined || filters.illustId !== undefined) suggestions.push('remove user_id/illust_id');
  if (filters.xRestrict !== undefined && filters.xRestrict !== 0) suggestions.push('fallback to r18=0');

  if (suggestions.length === 0) {
    suggestions.push('import more metadata and retry with fewer filters');
  }

  return {
    applied_filters: appliedFilters,
    suggestions,
  };
}

router.get('/', (req, res, next) => {
  (async () => {
    res.setHeader('Cache-Control', 'no-store');

    const env = getEnv();
    const requestIdRaw = (req as any).request_id;
    const requestId = typeof requestIdRaw === 'string' && requestIdRaw.trim() ? requestIdRaw.trim() : undefined;

    const format = parseFormat((req.query as any).format);
    const redirect = parseRedirect((req.query as any).redirect);
    const attempts = parseAttempts((req.query as any).attempts);
    const seed = parseSeed((req.query as any).seed);
    const random = seed ? mulberry32(fnv1a32(seed)) : Math.random;
    const xRestrict = parseR18((req.query as any).r18);
    const strictParam = parseR18Strict((req.query as any).r18_strict ?? (req.query as any).r18Strict);
    const r18Strict = strictParam ?? env.RANDOM_R18_STRICT;
    const orientation = parseOrientation((req.query as any).orientation);
    const minWidth = parseMinWidth((req.query as any).min_width);
    const minHeight = parseMinHeight((req.query as any).min_height);
    const minPixels = parseMinPixels((req.query as any).min_pixels);
    const includedTags = parseIncludedTags((req.query as any).included_tags);
    const excludedTags = parseExcludedTags((req.query as any).excluded_tags);
    const userId = parseUserId((req.query as any).user_id);
    const illustId = parseIllustId((req.query as any).illust_id);

    const filters: any = {};
    if (xRestrict !== undefined) filters.xRestrict = xRestrict;
    if (xRestrict === 0 && r18Strict) filters.xRestrictAllowUnknown = false;
    if (orientation !== undefined) filters.orientation = orientation;
    if (minWidth !== undefined) filters.minWidth = minWidth;
    if (minHeight !== undefined) filters.minHeight = minHeight;
    if (minPixels !== undefined) filters.minPixels = minPixels;
    if (includedTags !== undefined) filters.includedTags = includedTags;
    if (excludedTags !== undefined) filters.excludedTags = excludedTags;
    if (userId !== undefined) filters.userId = userId;
    if (illustId !== undefined) filters.illustId = illustId;

    if (redirect) {
      const image = await pickRandomImageRecord(filters, random);
      if (!image) {
        const err = new Error('No matching image.');
        (err as any).status = 404;
        (err as any).code = 'NO_MATCH';
        throw err;
      }

      incrementRandomSuccessTotal();
      if (isOpportunisticHydrateCandidate(image)) {
        void scheduleOpportunisticHydrate({ illustId: image.illustId, requestId });
      }
      res.redirect(302, `/i/${image.id.toString()}.${String(image.ext || 'jpg')}`);
      return;
    }

    if (format === 'json') {
      const debug: any = {};
      const image = await pickRandomImageRecord(filters, random, { withTags: true, debug });
      if (!image) {
        res.status(404).json({
          code: 'NO_MATCH',
          message: 'No matching image.',
          request_id: requestId,
          hints: buildNoMatchHints(filters),
        });
        return;
      }

      const tags = Array.isArray((image as any).imageTags)
        ? (image as any).imageTags.map((row: any) => row?.tag?.name).filter((name: any) => typeof name === 'string')
        : [];

      const proxyUrl = `/i/${image.id.toString()}.${String(image.ext || 'jpg')}`;
      const originUrl = String(image.originalUrl || '');

      const imgproxyUrl = env.IMGPROXY_URL && env.IMGPROXY_KEY && env.IMGPROXY_SALT && originUrl
        ? buildSignedImgproxyUrl({
          baseUrl: env.IMGPROXY_URL,
          keyHex: env.IMGPROXY_KEY,
          saltHex: env.IMGPROXY_SALT,
          processingOptions: 'raw:1',
          sourceUrl: originUrl,
          extension: String(image.ext || 'jpg'),
        })
        : undefined;

      incrementRandomSuccessTotal();
      if (isOpportunisticHydrateCandidate(image)) {
        void scheduleOpportunisticHydrate({ illustId: image.illustId, requestId });
      }
      res.json(
        buildRandomJsonResponse({
          image,
          tags,
          proxyUrl,
          originUrl,
          imgproxyUrl,
          attempt: attempts,
          pickedBy: debug.pickedBy,
        }),
      );
      return;
    }

    const abortController = new AbortController();
    res.on('close', () => abortController.abort());

    const picked = await pickRandomImageStream(filters, attempts, abortController.signal, random);
    if (!picked) {
      const err = new Error('No matching image.');
      (err as any).status = 404;
      (err as any).code = 'NO_MATCH';
      throw err;
    }

    const { image, originUrl, stream, attemptsUsed } = picked;
    const filename = originUrl.substring(originUrl.lastIndexOf('/') + 1) || `${image.id.toString()}.${String(image.ext || 'jpg')}`;

    observeRandomAttemptsHistogram(attemptsUsed);
    incrementRandomSuccessTotal();
    if (isOpportunisticHydrateCandidate(image)) {
      void scheduleOpportunisticHydrate({ illustId: image.illustId, requestId });
    }
    res.writeHead(200, {
      'Content-Type': getImageContentTypeFromFilename(filename) || 'application/octet-stream',
      'Content-Disposition': `filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Origin-URL': originUrl,
      'X-Crawl-Date': new Date().toUTCString(),
    });

    const sourceStream = stream as Readable;

    sourceStream.on('error', (err) => {
      if (abortController.signal.aborted) return;

      void markFail({
        id: image.id,
        errorCode: 'upstream_stream_error',
        errorMsg: err instanceof Error ? err.message : String(err),
        status: IMAGE_STATUS_BROKEN,
      });

      incrementRandomFailTotal();

      if (!res.headersSent) {
        res.status(502).end();
      } else {
        res.end();
      }

      sourceStream.destroy();
    });

    res.on('close', () => {
      if (!sourceStream.destroyed) sourceStream.destroy();
    });

    sourceStream.pipe(res);
  })().catch((err) => {
    incrementRandomFailTotal();
    next(err);
  });
});

export default router;
