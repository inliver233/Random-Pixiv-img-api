import path from 'node:path';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';

import { fetchPixivImageStream } from '../http/pixivImageHttp';
import { enqueueHealUrl } from '../jobs/healUrl';
import { IMAGE_STATUS_BROKEN, getById, markFail } from '../repositories/imagesRepo';
import { getImageContentTypeFromExt, isAllowedImageExt, normalizeImageExtension } from '../utils/contentType';

const responseHeaders = {
  'Cache-Control': 'max-age=31536000, public',
};

function renderError(res: Response, status: number, title: string, messageEn: string, messageZh = ''): void {
  res.status(status).render('error', {
    error_title: title,
    message_en: messageEn,
    message_zh: messageZh,
  });
}

function parsePositiveInteger(value: unknown): bigint | null {
  const raw = typeof value === 'string' ? value : String(value);
  if (!/^([1-9][0-9]*)$/.test(raw)) return null;
  return BigInt(raw);
}

function classifyUpstreamError(err: unknown): { status: number; code: string; message: string } {
  const anyErr = err as any;
  const status = Number(anyErr?.response?.status);
  if (Number.isFinite(status) && status > 0) {
    return { status, code: `upstream_${status}`, message: `upstream status ${status}` };
  }

  const code = typeof anyErr?.code === 'string' && anyErr.code ? anyErr.code : 'upstream_error';
  const message = anyErr instanceof Error ? anyErr.message : String(anyErr);
  return { status: 502, code, message };
}

async function safeMarkFail(imageId: bigint, info: { code: string; message: string; status?: number }) {
  try {
    await markFail({
      id: imageId,
      errorCode: info.code,
      errorMsg: info.message,
      status: info.status,
    });
  } catch {
    // best-effort
  }
}

async function getImageById(req: Request, res: Response) {
  const imageId = parsePositiveInteger((req.params as any).id);
  const ext = normalizeImageExtension((req.params as any).ext);

  if (!imageId || !ext || !isAllowedImageExt(ext)) {
    renderError(res, 400, '400 Bad Request', 'Invalid id or extension.');
    return;
  }

  const image = await getById(imageId);
  if (!image) {
    renderError(res, 404, '404 Not Found', 'Not Found');
    return;
  }

  if (String(image.ext || '').toLowerCase() !== ext) {
    renderError(res, 404, '404 Not Found', 'Not Found');
    return;
  }

  const originalUrl = image.originalUrl;

  const abortController = new AbortController();
  let sourceStream: Readable | null = null;
  let clientClosed = false;

  res.on('close', () => {
    clientClosed = true;
    abortController.abort();
    if (sourceStream && !sourceStream.destroyed) {
      sourceStream.destroy();
    }
  });

  try {
    const upstreamResponse = await fetchPixivImageStream(originalUrl, abortController.signal);

    const imageFilenameFromUrl = path.basename(originalUrl);
    const imageFilename = imageFilenameFromUrl || `${imageId.toString()}.${ext}`;

    sourceStream = upstreamResponse.data;

    res.writeHead(200, {
      'Content-Type': getImageContentTypeFromExt(ext) || 'application/octet-stream',
      'Content-Disposition': `filename="${imageFilename}"`,
      'X-Origin-URL': originalUrl,
      'X-Crawl-Date': new Date().toUTCString(),
      ...responseHeaders,
    });

    sourceStream.on('error', (streamErr) => {
      if (clientClosed) return;

      void safeMarkFail(imageId, {
        code: 'upstream_stream_error',
        message: streamErr instanceof Error ? streamErr.message : String(streamErr),
        status: IMAGE_STATUS_BROKEN,
      });

      if (!res.headersSent) {
        renderError(res, 502, '502 Bad Gateway', 'Upstream stream error.');
      } else {
        res.end();
      }
    });

    sourceStream.pipe(res);
  } catch (err: unknown) {
    const anyErr = err as any;
    if (clientClosed || anyErr?.code === 'ERR_CANCELED') {
      return;
    }

    const upstream = classifyUpstreamError(err);
    const markBroken = upstream.status === 403 || upstream.status === 404;

    await safeMarkFail(imageId, {
      code: upstream.code,
      message: upstream.message,
      status: markBroken ? IMAGE_STATUS_BROKEN : undefined,
    });

    if (markBroken) {
      void enqueueHealUrl(image.illustId).catch(() => undefined);
    }

    if (res.headersSent) {
      res.end();
      return;
    }

    if (upstream.status === 404 || upstream.status === 403) {
      renderError(res, 404, '404 Not Found', 'Upstream image not available.');
      return;
    }

    renderError(res, 502, '502 Bad Gateway', 'Upstream error.');
  }
}

const imageByIdController = {
  getImageById,
};

export default imageByIdController;
