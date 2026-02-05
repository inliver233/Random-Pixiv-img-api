import type { PrismaClient, ProxyScheme } from '@prisma/client';

import { getPrismaClient } from '../db/prismaClient';
import logger from '../logger/logger';

import { easyProxiesExport } from './easyProxiesClient';
import { parseProxyUri } from './proxyUri';

const EASY_PROXIES_CONFIG_KEY = 'easy_proxies_config';

export type EasyProxiesConflictPolicy = 'overwrite' | 'skip_non_easy_proxies';

export type EasyProxiesImportParams = {
  baseUrl: string;
  password?: string;
  sourceRef?: string;
  enabled?: boolean;
  conflictPolicy?: EasyProxiesConflictPolicy;
  prisma?: PrismaClient;
  fetch?: typeof fetch;
};

export type EasyProxiesImportResult =
  | {
      ok: true;
      baseUrl: string;
      total_lines: number;
      imported: number;
      invalid: number;
      conflicts: number;
      token_used: boolean;
      errors: Array<{ line: number; uri: string; error: string }>;
    }
  | { ok: false; baseUrl: string; status: number; error: string };

function normalizeBaseUrl(baseUrl: string): string {
  const raw = String(baseUrl ?? '').trim();
  if (!raw) throw new Error('easy_proxies baseUrl is required.');
  const u = new URL(raw);
  return u.origin;
}

export async function importProxyEndpointsFromEasyProxies(params: EasyProxiesImportParams): Promise<EasyProxiesImportResult> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);

  const exportRes = await easyProxiesExport({
    baseUrl,
    password: params.password,
    fetch: params.fetch,
  });

  if (!exportRes.ok) {
    return { ok: false, baseUrl, status: exportRes.status, error: exportRes.error };
  }

  const prisma = params.prisma ?? getPrismaClient();
  const enabled = params.enabled ?? true;
  const sourceRef = params.sourceRef ?? baseUrl;
  const conflictPolicy: EasyProxiesConflictPolicy = params.conflictPolicy ?? 'overwrite';

  const errors: Array<{ line: number; uri: string; error: string }> = [];
  let imported = 0;
  let invalid = 0;
  let conflicts = 0;

  for (let i = 0; i < exportRes.lines.length; i += 1) {
    const uri = exportRes.lines[i]!;
    const lineNo = i + 1;

    try {
      const parsed = parseProxyUri(uri);

      if (conflictPolicy === 'skip_non_easy_proxies') {
        const existing = await prisma.proxyEndpoint.findUnique({
          where: {
            scheme_host_port_username: {
              scheme: parsed.scheme as ProxyScheme,
              host: parsed.host,
              port: parsed.port,
              username: parsed.username,
            },
          },
          select: { source: true },
        });

        if (existing && existing.source !== 'easy_proxies') {
          conflicts += 1;
          continue;
        }
      }

      await prisma.proxyEndpoint.upsert({
        where: {
          scheme_host_port_username: {
            scheme: parsed.scheme as ProxyScheme,
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
          },
        },
        create: {
          scheme: parsed.scheme as ProxyScheme,
          host: parsed.host,
          port: parsed.port,
          username: parsed.username,
          password: parsed.password,
          enabled,
          source: 'easy_proxies',
          sourceRef,
        },
        update: {
          password: parsed.password,
          enabled,
          source: 'easy_proxies',
          sourceRef,
        },
      });

      imported += 1;
    } catch (err: unknown) {
      invalid += 1;
      errors.push({
        line: lineNo,
        uri,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    baseUrl,
    total_lines: exportRes.lines.length,
    imported,
    invalid,
    conflicts,
    token_used: Boolean(exportRes.token),
    errors,
  };
}

export type EasyProxiesRuntimeConfig = {
  source: 'db' | 'env' | 'none';
  baseUrl: string | null;
  password?: string;
  autoRefreshEnabled: boolean;
  refreshIntervalMs: number;
};

function coerceBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function coerceInt(value: unknown, defaultValue: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return defaultValue;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return defaultValue;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function parseConfigValue(value: unknown): Partial<EasyProxiesRuntimeConfig> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  const baseUrl = normalizeOptionalText(record.baseUrl ?? record.base_url);
  const password = normalizeOptionalText(record.password);
  const enabled = coerceBoolean(record.autoRefreshEnabled ?? record.auto_refresh_enabled, true);
  const refreshIntervalMs = Math.max(
    60_000,
    coerceInt(record.refreshIntervalMs ?? record.refresh_interval_ms, 30 * 60_000),
  );

  return {
    baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : null,
    password: password || undefined,
    autoRefreshEnabled: enabled,
    refreshIntervalMs,
  };
}

export async function loadEasyProxiesRuntimeConfig(params: { prisma?: PrismaClient } = {}): Promise<EasyProxiesRuntimeConfig> {
  const envBaseUrlRaw = String(process.env.EASY_PROXIES_BASE_URL || '').trim();
  const envPassword = String(process.env.EASY_PROXIES_PASSWORD || '').trim() || undefined;

  const envConfig: EasyProxiesRuntimeConfig = {
    source: envBaseUrlRaw ? 'env' : 'none',
    baseUrl: envBaseUrlRaw ? normalizeBaseUrl(envBaseUrlRaw) : null,
    password: envPassword,
    autoRefreshEnabled: true,
    refreshIntervalMs: 30 * 60_000,
  };

  try {
    const prisma = params.prisma ?? getPrismaClient();
    const row = await prisma.runtimeSetting.findUnique({ where: { key: EASY_PROXIES_CONFIG_KEY }, select: { value: true } });
    const parsed = parseConfigValue(row?.value);
    if (parsed) {
      return {
        source: 'db',
        baseUrl: parsed.baseUrl ?? null,
        password: parsed.password,
        autoRefreshEnabled: parsed.autoRefreshEnabled ?? true,
        refreshIntervalMs: parsed.refreshIntervalMs ?? 30 * 60_000,
      };
    }
  } catch {
    // ignore
  }

  return envConfig;
}

type EasyProxiesAutoRefreshState = {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  lastRunAt: number | null;
  lastResult: null | { ok: boolean; status?: number; imported?: number; invalid?: number; conflicts?: number; error?: string };
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatEasyProxiesAutoRefreshState: EasyProxiesAutoRefreshState | undefined;
}

function getAutoRefreshState(): EasyProxiesAutoRefreshState {
  globalThis.__pixivcatEasyProxiesAutoRefreshState ??= { timer: null, inFlight: false, lastRunAt: null, lastResult: null };
  return globalThis.__pixivcatEasyProxiesAutoRefreshState;
}

const AUTO_REFRESH_POLL_MS = 30_000;

async function runAutoRefreshTick(params: { prisma?: PrismaClient }): Promise<void> {
  const state = getAutoRefreshState();
  if (state.inFlight) return;

  state.inFlight = true;
  const startedAt = Date.now();

  try {
    const config = await loadEasyProxiesRuntimeConfig({ prisma: params.prisma });
    if (!config.baseUrl || !config.autoRefreshEnabled) {
      state.lastResult = { ok: true, imported: 0, invalid: 0, conflicts: 0 };
      state.lastRunAt = startedAt;
      return;
    }

    if (state.lastRunAt !== null && startedAt - state.lastRunAt < config.refreshIntervalMs) {
      return;
    }

    const result = await importProxyEndpointsFromEasyProxies({
      baseUrl: config.baseUrl,
      password: config.password,
      prisma: params.prisma,
      conflictPolicy: 'skip_non_easy_proxies',
      sourceRef: config.baseUrl,
      enabled: true,
    });

    if (result.ok) {
      state.lastResult = { ok: true, imported: result.imported, invalid: result.invalid, conflicts: result.conflicts, status: 200 };
    } else {
      state.lastResult = { ok: false, status: result.status, error: result.error };
    }
    state.lastRunAt = startedAt;
  } catch (err: unknown) {
    state.lastResult = { ok: false, status: 500, error: err instanceof Error ? err.message : String(err) };
    state.lastRunAt = startedAt;
    logger.warn({ err: state.lastResult.error }, 'easy_proxies auto refresh failed');
  } finally {
    state.inFlight = false;
  }
}

export function ensureEasyProxiesAutoRefreshStarted(params: { prisma?: PrismaClient; allowInTest?: boolean } = {}): void {
  const allowInTest = Boolean(params.allowInTest);
  if (!allowInTest && process.env.NODE_ENV === 'test') return;

  const state = getAutoRefreshState();
  if (state.timer) return;

  state.timer = setInterval(() => {
    void runAutoRefreshTick({ prisma: params.prisma });
  }, AUTO_REFRESH_POLL_MS);

  void runAutoRefreshTick({ prisma: params.prisma });
}

export function getEasyProxiesAutoRefreshSnapshot(): {
  running: boolean;
  last_run_at: string | null;
  last_result: EasyProxiesAutoRefreshState['lastResult'];
  poll_interval_ms: number;
} {
  const state = getAutoRefreshState();
  return {
    running: Boolean(state.timer),
    last_run_at: state.lastRunAt ? new Date(state.lastRunAt).toISOString() : null,
    last_result: state.lastResult,
    poll_interval_ms: AUTO_REFRESH_POLL_MS,
  };
}
