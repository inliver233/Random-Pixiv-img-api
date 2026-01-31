import { Router } from 'express';
import type { Readable } from 'node:stream';

import { getImageContentTypeFromFilename } from '../utils/contentType';
import { pickRandomImageRecord, pickRandomImageStream } from '../services/randomService';
import { IMAGE_STATUS_BROKEN, markFail } from '../repositories/imagesRepo';

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

function parseR18(value: unknown): number | undefined {
  if (value === undefined || value === null) return 0;

  const raw = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  const normalized = raw.trim().toLowerCase();

  if (!normalized) {
    const err = new Error('Invalid r18.');
    (err as any).status = 400;
    throw err;
  }

  if (normalized === 'any') return undefined;

  if (normalized === '0' || normalized === '1' || normalized === '2') {
    return Number(normalized);
  }

  const err = new Error('Invalid r18.');
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

router.get('/', (req, res, next) => {
  (async () => {
    res.setHeader('Cache-Control', 'no-store');

    const format = parseFormat((req.query as any).format);
    const redirect = parseRedirect((req.query as any).redirect);
    const attempts = parseAttempts((req.query as any).attempts);
    const seed = parseSeed((req.query as any).seed);
    const random = seed ? mulberry32(fnv1a32(seed)) : Math.random;
    const xRestrict = parseR18((req.query as any).r18);
    const orientation = parseOrientation((req.query as any).orientation);
    const minWidth = parseMinWidth((req.query as any).min_width);
    const minHeight = parseMinHeight((req.query as any).min_height);
    const minPixels = parseMinPixels((req.query as any).min_pixels);
    const includedTags = parseIncludedTags((req.query as any).included_tags);
    const excludedTags = parseExcludedTags((req.query as any).excluded_tags);

    const filters: any = {};
    if (xRestrict !== undefined) filters.xRestrict = xRestrict;
    if (orientation !== undefined) filters.orientation = orientation;
    if (minWidth !== undefined) filters.minWidth = minWidth;
    if (minHeight !== undefined) filters.minHeight = minHeight;
    if (minPixels !== undefined) filters.minPixels = minPixels;
    if (includedTags !== undefined) filters.includedTags = includedTags;
    if (excludedTags !== undefined) filters.excludedTags = excludedTags;

    if (redirect) {
      const image = await pickRandomImageRecord(filters, random);
      if (!image) {
        const err = new Error('No matching image.');
        (err as any).status = 404;
        (err as any).code = 'NO_MATCH';
        throw err;
      }

      res.redirect(302, `/i/${image.id.toString()}.${String(image.ext || 'jpg')}`);
      return;
    }

    if (format === 'json') {
      const image = await pickRandomImageRecord(filters, random);
      if (!image) {
        const err = new Error('No matching image.');
        (err as any).status = 404;
        (err as any).code = 'NO_MATCH';
        throw err;
      }

      const id = bigintToSafeNumber(image.id, 'IMAGE_ID_OUT_OF_RANGE');
      const illustId = bigintToSafeNumber(image.illustId, 'ILLUST_ID_OUT_OF_RANGE');

      res.json({
        image: {
          id,
          illust_id: illustId,
          page_index: image.pageIndex,
          ext: image.ext,
        },
        urls: {
          proxy: `/i/${image.id.toString()}.${String(image.ext || 'jpg')}`,
          original: String(image.originalUrl || ''),
        },
      });
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

    const { image, originUrl, stream } = picked;
    const filename = originUrl.substring(originUrl.lastIndexOf('/') + 1) || `${image.id.toString()}.${String(image.ext || 'jpg')}`;

    res.writeHead(200, {
      'Content-Type': getImageContentTypeFromFilename(filename) || 'application/octet-stream',
      'Content-Disposition': `filename="${filename}"`,
      'Access-Control-Allow-Origin': '*',
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
  })().catch(next);
});

export default router;
