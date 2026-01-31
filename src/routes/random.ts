import { Router } from 'express';
import type { Readable } from 'node:stream';

import { getImageContentTypeFromFilename } from '../utils/contentType';
import { pickRandomImageRecord, pickRandomImageStream } from '../services/randomService';
import { IMAGE_STATUS_BROKEN, markFail } from '../repositories/imagesRepo';

const router = Router();

function parseFormat(value: unknown): 'image' | 'json' {
  const raw = Array.isArray(value) ? String(value[0] || '') : String(value || '');
  return raw.trim().toLowerCase() === 'json' ? 'json' : 'image';
}

function parseRedirect(value: unknown): boolean {
  const raw = Array.isArray(value) ? String(value[0] || '') : String(value || '');
  return raw.trim() === '1';
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

router.get('/', (req, res, next) => {
  (async () => {
    res.setHeader('Cache-Control', 'no-store');

    const format = parseFormat((req.query as any).format);
    const redirect = parseRedirect((req.query as any).redirect);

    // MVP defaults: r18=0 (x_restrict=0) and fixed attempts.
    const filters = { xRestrict: 0 };

    if (redirect) {
      const image = await pickRandomImageRecord(filters);
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
      const image = await pickRandomImageRecord(filters);
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

    const picked = await pickRandomImageStream(filters, DEFAULT_ATTEMPTS, abortController.signal);
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
