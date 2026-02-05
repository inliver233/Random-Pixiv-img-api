import type { PrismaClient, RuntimeSetting } from '@prisma/client';

import { getPrismaClient } from '../db/prismaClient';
import { getEnv } from './env.ts';

export const RUNTIME_SETTING_KEYS = {
  proxyFailClosed: 'proxy_fail_closed',
  proxyRetryAttempts: 'proxy_retry_attempts',
  proxyRouteMode: 'proxy_route_mode',
  proxyRouteAllowlistDomains: 'proxy_route_allowlist_domains',
  adminImportMaxHydrateIllusts: 'admin_import_max_hydrate_illusts',
} as const;

export type ProxyRouteMode = 'pixiv_only' | 'all' | 'allowlist';

export type RuntimeConfig = {
  proxyFailClosed: boolean;
  proxyRetryAttempts: number;
  proxyRouteMode: ProxyRouteMode;
  proxyRouteAllowlistDomains: string[];
  hydrateOnImport: boolean;
  opportunisticHydrate: boolean;
  adminImportMaxHydrateIllusts: number;
};

export function getRuntimeConfigDefaults(): RuntimeConfig {
  const env = getEnv();

  return {
    proxyFailClosed: false,
    proxyRetryAttempts: 2,
    proxyRouteMode: 'pixiv_only',
    proxyRouteAllowlistDomains: [],
    // Backward compatible default: historically import always enqueued hydrate jobs (unless skipped by count guard).
    hydrateOnImport: true,
    opportunisticHydrate: false,
    adminImportMaxHydrateIllusts: env.ADMIN_IMPORT_MAX_HYDRATE_ILLUSTS,
  };
}

type RuntimeSettingInput = Pick<RuntimeSetting, 'key' | 'value'>;

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

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\n|]/g)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return [];
}

function coerceProxyRouteMode(value: unknown, defaultValue: ProxyRouteMode): ProxyRouteMode {
  if (value === 'pixiv_only' || value === 'all' || value === 'allowlist') return value;
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'pixiv_only' || normalized === 'all' || normalized === 'allowlist') return normalized;
  return defaultValue;
}

export function resolveRuntimeConfig(defaults: RuntimeConfig, settings: RuntimeSettingInput[]): RuntimeConfig {
  const resolved: RuntimeConfig = { ...defaults };

  for (const setting of settings) {
    if (!setting?.key) continue;

    switch (setting.key) {
      case RUNTIME_SETTING_KEYS.proxyFailClosed:
        resolved.proxyFailClosed = coerceBoolean(setting.value, defaults.proxyFailClosed);
        break;
      case RUNTIME_SETTING_KEYS.proxyRetryAttempts:
        resolved.proxyRetryAttempts = Math.max(0, coerceInt(setting.value, defaults.proxyRetryAttempts));
        break;
      case RUNTIME_SETTING_KEYS.proxyRouteMode:
        resolved.proxyRouteMode = coerceProxyRouteMode(setting.value, defaults.proxyRouteMode);
        break;
      case RUNTIME_SETTING_KEYS.proxyRouteAllowlistDomains:
        resolved.proxyRouteAllowlistDomains = coerceStringArray(setting.value);
        break;
      case RUNTIME_SETTING_KEYS.adminImportMaxHydrateIllusts:
        resolved.adminImportMaxHydrateIllusts = Math.max(0, coerceInt(setting.value, defaults.adminImportMaxHydrateIllusts));
        break;
      default:
        break;
    }
  }

  return resolved;
}

export async function loadRuntimeConfig(prisma?: PrismaClient): Promise<RuntimeConfig> {
  const defaults = getRuntimeConfigDefaults();
  const client = prisma ?? getPrismaClient();
  const settings = await client.runtimeSetting.findMany({ select: { key: true, value: true } });
  return resolveRuntimeConfig(defaults, settings);
}

export type RuntimeSettingAudit = {
  updatedBy?: string;
  updatedFromIp?: string;
  updatedRequestId?: string;
};

export async function upsertRuntimeSetting(
  key: string,
  value: unknown,
  audit: RuntimeSettingAudit = {},
  prisma?: PrismaClient,
): Promise<void> {
  const client = prisma ?? getPrismaClient();
  await client.runtimeSetting.upsert({
    where: { key },
    create: {
      key,
      value: value as any,
      updatedBy: audit.updatedBy,
      updatedFromIp: audit.updatedFromIp,
      updatedRequestId: audit.updatedRequestId,
    },
    update: {
      value: value as any,
      updatedBy: audit.updatedBy,
      updatedFromIp: audit.updatedFromIp,
      updatedRequestId: audit.updatedRequestId,
    },
  });
}
