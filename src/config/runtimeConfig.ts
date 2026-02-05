import type { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../db/prismaClient';
import { invalidateProxyEndpointCache } from '../proxy/proxyEndpointStore';
import { invalidateTokenStoreCache } from '../services/tokenStore';

import { getRuntimeConfigDefaults, resolveRuntimeConfig, type RuntimeConfig } from './runtimeSettings';

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
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatRuntimeConfigState: RuntimeConfigState | undefined;
}

const DEFAULT_CACHE_TTL_MS = 1000;

function getRuntimeConfigState(): RuntimeConfigState {
  globalThis.__pixivcatRuntimeConfigState ??= { version: 0, cache: null, inFlight: null };
  return globalThis.__pixivcatRuntimeConfigState;
}

function hasDatabaseUrl(): boolean {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
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

export function invalidateRuntimeCaches(options: RuntimeCacheInvalidation = {}): number {
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

  return state.version;
}

export async function getRuntimeConfigSnapshot(params: {
  prisma?: PrismaClient;
  cacheTtlMs?: number;
} = {}): Promise<RuntimeConfigSnapshot> {
  const state = getRuntimeConfigState();

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

    const canQueryDb = Boolean(params.prisma) || hasDatabaseUrl();
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
