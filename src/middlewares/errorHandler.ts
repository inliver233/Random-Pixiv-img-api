import { STATUS_CODES } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

import logger from '../logger/logger';

type ErrorWithMeta = Error & {
  status?: number;
  statusCode?: number;
  code?: string;
};

function maskUrlQuery(value: string): string {
  const raw = value.trim();
  if (!raw) return raw;

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    const noHash = raw.split('#')[0] ?? raw;
    return (noHash.split('?')[0] ?? noHash).trim();
  }
}

function maskUrlsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/g, (match) => maskUrlQuery(match));
}

function normalizeOriginUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return maskUrlQuery(trimmed);
}

function buildSafeErrorMeta(err: unknown): Record<string, unknown> {
  const anyErr = err as any;

  const code = typeof anyErr?.code === 'string' && anyErr.code ? anyErr.code : undefined;
  const statusCandidate = Number(anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status);
  const status = Number.isFinite(statusCandidate) && statusCandidate > 0 ? statusCandidate : undefined;

  const messageRaw = anyErr instanceof Error
    ? anyErr.message
    : typeof anyErr?.message === 'string' && anyErr.message
      ? anyErr.message
      : String(anyErr ?? '');

  const originUrl = normalizeOriginUrl(anyErr?.origin_url ?? anyErr?.originUrl ?? anyErr?.config?.url);

  return {
    ...(code ? { code } : {}),
    ...(status ? { status } : {}),
    ...(originUrl ? { origin_url: originUrl } : {}),
    message: maskUrlsInText(messageRaw),
    ...(anyErr instanceof Error && anyErr.stack ? { stack: anyErr.stack } : {}),
  };
}

function getRequestId(req: Request, res: Response): string | undefined {
  return (req as any).request_id || res.locals.request_id;
}

function wantsJson(req: Request): boolean {
  const path = req.path || '';
  const accept = req.header('accept') || '';
  const acceptJson = accept.includes('application/json');

  if (path.startsWith('/random')) {
    const format = (req.query as any)?.format;
    return (
      acceptJson
      || format === 'json'
      || (Array.isArray(format) && format.includes('json'))
    );
  }

  return (
    path.startsWith('/images')
    || path.startsWith('/admin')
    || path.startsWith('/metrics')
    || path.startsWith('/healthz')
  );
}

function normalizeError(err: unknown): { status: number; code: string; message: string } {
  const maybe = err as Partial<ErrorWithMeta> | null;

  const statusCandidate = Number(maybe?.status ?? maybe?.statusCode);
  const status = Number.isFinite(statusCandidate) && statusCandidate >= 400 && statusCandidate <= 599 ? statusCandidate : 500;

  const codeFromError = typeof maybe?.code === 'string' && maybe.code ? maybe.code : null;
  const codeFromStatus = status === 400
    ? 'BAD_REQUEST'
    : status === 401
      ? 'UNAUTHORIZED'
      : status === 403
        ? 'FORBIDDEN'
        : status === 404
          ? 'NOT_FOUND'
          : status === 429
            ? 'RATE_LIMIT'
            : status >= 500
              ? 'INTERNAL_SERVER_ERROR'
              : 'ERROR';

  const message = status >= 500 ? 'Internal Server Error' : maskUrlsInText(maybe?.message || 'Error');

  return {
    status,
    code: codeFromError || codeFromStatus,
    message,
  };
}

export default function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const requestId = getRequestId(req, res);
  const normalized = normalizeError(err);

  logger.error(
    {
      request_id: requestId,
      err: buildSafeErrorMeta(err),
      status: normalized.status,
      code: normalized.code,
      route: (req as any).route?.path ? `${req.baseUrl || ''}${(req as any).route.path}` : req.path,
    },
    'error',
  );

  if (wantsJson(req)) {
    res.status(normalized.status).json({
      code: normalized.code,
      message: normalized.message,
      request_id: requestId,
    });
    return;
  }

  const title = `${normalized.status} ${STATUS_CODES[normalized.status] || 'Error'}`;
  res.status(normalized.status).render('error', {
    error_title: title,
    message_en: normalized.message,
    message_zh: '',
    request_id: requestId,
  });
}
