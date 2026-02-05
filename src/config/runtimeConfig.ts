import type { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../db/prismaClient';
import logger from '../logger/logger';
import { invalidateProxyEndpointCache } from '../proxy/proxyEndpointStore';
import { invalidateTokenStoreCache } from '../services/tokenStore';

import { getRuntimeConfigDefaults, resolveRuntimeConfig, type RuntimeConfig } from './runtimeSettings';
import { ensureRuntimeCacheNotifyListenerStarted, publishRuntimeCacheInvalidation } from './notify';

export type RuntimeConfigSource = 'db' | 'defaults' | 'cache';

export type RuntimeConfigSnapshot = {
  version: number;
  source: RuntimeConfigSource;
  fetchedAt: number;
  config: RuntimeConfig;
};

type RuntimeConfigState = {
  version: number;
  cache: RuntimeConfigSnapshot | null;
  inFlight: Promise<RuntimeConfigSnapshot> | null;
  proxyDisabledWarnedAtVersion: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatRuntimeConfigState: RuntimeConfigState | undefined;
}

const DEFAULT_CACHE_TTL_MS = 1000;
let notifyListenerHooked = false;

function getRuntimeConfigState(): RuntimeConfigState {
  globalThis.__pixivcatRuntimeConfigState ??= { version: 0, cache: null, inFlight: null, proxyDisabledWarnedAtVersion: -1 };
  return globalThis.__pixivcatRuntimeConfigState;
}

function hasDatabaseUrl(): boolean {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

function ensureRuntimeNotifyListener(): void {
  if (notifyListenerHooked) return;
  if (process.env.NODE_ENV === 'test') return;
  if (!hasDatabaseUrl()) return;

  notifyListenerHooked = true;
  ensureRuntimeCacheNotifyListenerStarted({
    onInvalidation: (options) => {
      try {
        invalidateRuntimeCaches(options, { broadcast: false });
      } catch {
        // best-effort
      }
    },
  });
}

async function loadFromDb(prisma: PrismaClient): Promise<RuntimeConfig> {
  const defaults = getRuntimeConfigDefaults();
  const settings =
    typeof (prisma as any)?.runtimeSetting?.findMany === 'function'
      ? await (prisma as any).runtimeSetting.findMany({ select: { key: true, value: true } })
      : [];

  const resolved = resolveRuntimeConfig(defaults, settings);

  const hydrationPolicyRow =
    typeof (prisma as any)?.hydrationPolicy?.findFirst === 'function'
      ? await (prisma as any).hydrationPolicy.findFirst({
        orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        select: { enabled: true, hydrateOnImport: true, opportunisticHydrate: true },
      })
      : null;

  if (!hydrationPolicyRow) {
    return resolved;
  }

  if (!hydrationPolicyRow.enabled) {
    return { ...resolved, hydrateOnImport: false, opportunisticHydrate: false };
  }

  return {
    ...resolved,
    hydrateOnImport: Boolean(hydrationPolicyRow.hydrateOnImport),
    opportunisticHydrate: Boolean(hydrationPolicyRow.opportunisticHydrate),
  };
}

export type RuntimeCacheInvalidation = {
  settings?: boolean;
  tokens?: boolean;
  proxies?: boolean;
};

export function invalidateRuntimeCaches(options: RuntimeCacheInvalidation = {}, params: { broadcast?: boolean } = {}): number {
  const state = getRuntimeConfigState();

  const empty = options.settings === undefined && options.tokens === undefined && options.proxies === undefined;
  const invalidateSettings = empty || options.settings;
  const invalidateTokens = empty || options.tokens;
  const invalidateProxies = empty || options.proxies;

  state.version += 1;

  if (invalidateSettings) {
    state.cache = null;
    state.inFlight = null;
  }

  if (invalidateTokens) {
    invalidateTokenStoreCache();
  }

  if (invalidateProxies) {
    invalidateProxyEndpointCache();
  }

  const shouldBroadcast = params.broadcast ?? true;
  if (shouldBroadcast) {
    ensureRuntimeNotifyListener();
    void publishRuntimeCacheInvalidation({
      settings: Boolean(invalidateSettings),
      tokens: Boolean(invalidateTokens),
      proxies: Boolean(invalidateProxies),
    });
  }

  return state.version;
}

export async function getRuntimeConfigSnapshot(params: {
  prisma?: PrismaClient;
  cacheTtlMs?: number;
} = {}): Promise<RuntimeConfigSnapshot> {
  const state = getRuntimeConfigState();
  ensureRuntimeNotifyListener();

  const ttl = params.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = Date.now();

  const cached = state.cache;
  if (cached && now - cached.fetchedAt < ttl) {
    return cached;
  }

  if (state.inFlight) {
    return state.inFlight;
  }

  const version = state.version;

  const loadPromise = (async (): Promise<RuntimeConfigSnapshot> => {
    const defaults = getRuntimeConfigDefaults();

    // Unit tests in this repo mock Prisma I/O; avoid hitting a real DB in NODE_ENV=test unless a Prisma client is injected.
    const canQueryDb = Boolean(params.prisma) || (process.env.NODE_ENV !== 'test' && hasDatabaseUrl());
    if (canQueryDb) {
      try {
        const prisma = params.prisma ?? getPrismaClient();
        const config = await loadFromDb(prisma);
        return { version, source: 'db', fetchedAt: Date.now(), config };
      } catch {
        // fallthrough to cached/defaults
      }
    }

    if (state.cache) {
      return { ...state.cache, version, source: 'cache', fetchedAt: Date.now() };
    }

    return { version, source: 'defaults', fetchedAt: Date.now(), config: defaults };
  })();

  state.inFlight = loadPromise;

  try {
    const loaded = await loadPromise;

    if (!loaded.config.proxyEnabled && state.proxyDisabledWarnedAtVersion !== version) {
      state.proxyDisabledWarnedAtVersion = version;
      logger.warn({
        proxy_enabled: false,
        proxy_fail_closed: loaded.config.proxyFailClosed,
        proxy_route_mode: loaded.config.proxyRouteMode,
        runtime_config_source: loaded.source,
        runtime_config_version: version,
      }, 'Proxy is disabled: outbound requests will use direct connections (real IP exposure risk).');
    }

    if (state.version === version) {
      state.cache = loaded;
    }
    return loaded;
  } finally {
    if (state.inFlight === loadPromise) {
      state.inFlight = null;
    }
  }
}

export async function getEffectiveRuntimeConfig(params: {
  prisma?: PrismaClient;
  cacheTtlMs?: number;
} = {}): Promise<RuntimeConfig> {
  const snapshot = await getRuntimeConfigSnapshot(params);
  return snapshot.config;
}

export function resetRuntimeConfigForTest(): void {
  globalThis.__pixivcatRuntimeConfigState = undefined;
}
