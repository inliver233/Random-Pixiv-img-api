import type { Request, Response } from 'express';

import { getEnv } from '../config/env';
import logger from '../logger/logger';
import { createRequestLog, deleteRequestLogsBefore } from '../repositories/requestLogsRepo';

type RequestLogState = {
  prefixesRaw: string | null;
  prefixes: string[];
  lastCleanupAtMs: number;
  cleanupInFlight: Promise<void> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatRequestLog: RequestLogState | undefined;
}

function ensureState(): RequestLogState {
  globalThis.__pixivcatRequestLog ??= {
    prefixesRaw: null,
    prefixes: [],
    lastCleanupAtMs: 0,
    cleanupInFlight: null,
  };

  return globalThis.__pixivcatRequestLog;
}

function parsePrefixes(raw: string): string[] {
  const tokens = String(raw || '')
    .split(/[,\s|]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const prefixes: string[] = [];
  for (const token of tokens) {
    const normalized = token.startsWith('/') ? token : `/${token}`;
    prefixes.push(normalized);
  }

  return prefixes;
}

function getCachedPrefixes(): string[] {
  const env = getEnv();
  const raw = String(env.REQUEST_LOG_PATH_PREFIXES || '').trim();

  const state = ensureState();
  if (state.prefixesRaw !== raw) {
    state.prefixesRaw = raw;
    state.prefixes = raw ? parsePrefixes(raw) : [];
  }

  return state.prefixes;
}

function normalizeFullPath(req: Request): string {
  const base = String(req.baseUrl || '');
  const path = String(req.path || '');
  return `${base}${path}`;
}

function isExcludedPath(fullPath: string, metricsRoute: string): boolean {
  if (fullPath.startsWith('/admin')) return true;
  if (fullPath === '/healthz' || fullPath.startsWith('/healthz/')) return true;
  if (metricsRoute && (fullPath === metricsRoute || fullPath.startsWith(`${metricsRoute}/`))) return true;
  return false;
}

function isAllowedPath(fullPath: string, prefixes: string[]): boolean {
  if (prefixes.length === 0) return true;
  return prefixes.some((prefix) => fullPath === prefix || fullPath.startsWith(prefix));
}

function clampString(value: unknown, maxLen: number): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value);
  if (!s) return null;
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

function getRequestId(req: Request, res: Response): string | null {
  const requestId = (req as any).request_id || res.locals?.request_id;
  return typeof requestId === 'string' && requestId.trim() ? requestId.trim() : null;
}

function scheduleCleanupIfNeeded(): void {
  const env = getEnv();
  if (!env.REQUEST_LOG_ENABLED) return;

  const retentionDays = Math.max(0, Math.trunc(env.REQUEST_LOG_RETENTION_DAYS || 0));
  if (retentionDays === 0) return;

  const state = ensureState();
  if (state.cleanupInFlight) return;

  const intervalMs = 60 * 60 * 1000; // 1 hour
  const now = Date.now();
  if (state.lastCleanupAtMs > 0 && now - state.lastCleanupAtMs < intervalMs) return;

  state.cleanupInFlight = (async () => {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const deleted = await deleteRequestLogsBefore(cutoff);
    logger.info({ retention_days: retentionDays, deleted }, 'request_log cleanup');
    state.lastCleanupAtMs = Date.now();
  })()
    .catch((err: unknown) => {
      logger.warn({ err }, 'request_log cleanup failed');
      state.lastCleanupAtMs = Date.now();
    })
    .finally(() => {
      state.cleanupInFlight = null;
    });
}

export async function maybeRecordRequestLog(params: {
  req: Request;
  res: Response;
  routeLabel: string;
  durationMs: number;
}): Promise<void> {
  try {
    const env = getEnv();
    if (!env.REQUEST_LOG_ENABLED) return;

    const sampleRate = Number(env.REQUEST_LOG_SAMPLE_RATE || 0);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return;
    if (sampleRate < 1 && Math.random() >= sampleRate) return;

    const fullPath = normalizeFullPath(params.req);
    if (isExcludedPath(fullPath, env.METRICS_ROUTE)) return;

    const prefixes = getCachedPrefixes();
    if (!isAllowedPath(fullPath, prefixes)) return;

    scheduleCleanupIfNeeded();

    await createRequestLog({
      requestId: getRequestId(params.req, params.res),
      method: String(params.req.method || 'GET'),
      route: String(params.routeLabel || fullPath),
      url: clampString(params.req.originalUrl, 2048),
      status: params.res.statusCode,
      durationMs: params.durationMs,
      ip: clampString(params.req.ip, 64),
      userAgent: clampString(params.req.header('user-agent'), 256),
      sampleRate,
    });
  } catch (err: unknown) {
    logger.warn(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      'request_log persist failed',
    );
  }
}

