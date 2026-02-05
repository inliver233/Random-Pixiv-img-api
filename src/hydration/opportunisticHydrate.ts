import { getEffectiveRuntimeConfig } from '../config/runtimeConfig';
import { enqueueHydrateMetadata } from '../jobs/hydrateMetadata';

export type OpportunisticHydrateDecision = {
  scheduled: boolean;
  reason:
    | 'scheduled'
    | 'disabled'
    | 'deduped'
    | 'rate_limited'
    | 'invalid_illust_id'
    | 'config_error'
    | 'enqueue_failed';
};

export type OpportunisticHydrateParams = {
  illustId: bigint;
  requestId?: string;
};

export type OpportunisticHydrateDeps = {
  now?: () => number;
  getRuntimeConfig?: () => Promise<{ opportunisticHydrate: boolean }>;
  enqueueHydrate?: (illustId: bigint, requestId?: string) => Promise<string>;
  dedupeTtlMs?: number;
  windowMs?: number;
  maxPerWindow?: number;
};

type OpportunisticHydrateState = {
  dedupe: Map<string, number>;
  windowStart: number;
  windowCount: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatOpportunisticHydrateState: OpportunisticHydrateState | undefined;
}

const DEFAULT_DEDUPE_TTL_MS = 30 * 60_000;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_WINDOW = 30;
const MAX_TRACKED_ILLUSTS = 5000;

function getState(): OpportunisticHydrateState {
  globalThis.__pixivcatOpportunisticHydrateState ??= {
    dedupe: new Map(),
    windowStart: 0,
    windowCount: 0,
  };
  return globalThis.__pixivcatOpportunisticHydrateState;
}

export function resetOpportunisticHydrateStateForTest(): void {
  globalThis.__pixivcatOpportunisticHydrateState = undefined;
}

function normalizeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function pruneDedupeMap(map: Map<string, number>, now: number, ttlMs: number): void {
  if (map.size <= MAX_TRACKED_ILLUSTS) return;

  for (const [key, ts] of map.entries()) {
    if (now - ts > ttlMs) {
      map.delete(key);
    }
  }

  if (map.size > MAX_TRACKED_ILLUSTS) {
    map.clear();
  }
}

function consumeQuota(params: {
  state: OpportunisticHydrateState;
  key: string;
  now: number;
  dedupeTtlMs: number;
  windowMs: number;
  maxPerWindow: number;
}): { ok: true } | { ok: false; reason: 'deduped' | 'rate_limited' } {
  const { state, key, now, dedupeTtlMs, windowMs, maxPerWindow } = params;

  const lastAt = state.dedupe.get(key);
  if (typeof lastAt === 'number' && now - lastAt < dedupeTtlMs) {
    return { ok: false, reason: 'deduped' };
  }

  if (state.windowStart <= 0 || now - state.windowStart >= windowMs) {
    state.windowStart = now;
    state.windowCount = 0;
  }

  if (state.windowCount >= maxPerWindow) {
    return { ok: false, reason: 'rate_limited' };
  }

  state.dedupe.set(key, now);
  state.windowCount += 1;
  pruneDedupeMap(state.dedupe, now, dedupeTtlMs);

  return { ok: true };
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}

export function isOpportunisticHydrateCandidate(image: any): boolean {
  if (!image || typeof image !== 'object') return false;

  if (isMissing(image.width) || isMissing(image.height)) return true;
  if (isMissing(image.userId) || isMissing(image.userName)) return true;
  if (isMissing(image.title) || isMissing(image.createdAtPixiv)) return true;
  if (isMissing(image.xRestrict)) return true;

  return false;
}

export async function scheduleOpportunisticHydrate(
  params: OpportunisticHydrateParams,
  deps: OpportunisticHydrateDeps = {},
): Promise<OpportunisticHydrateDecision> {
  try {
    const illustId = params?.illustId;
    if (typeof illustId !== 'bigint' || illustId <= 0n) {
      return { scheduled: false, reason: 'invalid_illust_id' };
    }

    const nowFn = deps.now ?? (() => Date.now());
    const now = nowFn();

    const getRuntimeConfig = deps.getRuntimeConfig ?? (async () => {
      const config = await getEffectiveRuntimeConfig();
      return { opportunisticHydrate: Boolean(config.opportunisticHydrate) };
    });

    let config: { opportunisticHydrate: boolean };
    try {
      config = await getRuntimeConfig();
    } catch {
      return { scheduled: false, reason: 'config_error' };
    }

    if (!config.opportunisticHydrate) {
      return { scheduled: false, reason: 'disabled' };
    }

    const state = getState();

    const dedupeTtlMs = Math.max(0, Math.trunc(Number(deps.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS)));
    const windowMs = Math.max(1, Math.trunc(Number(deps.windowMs ?? DEFAULT_WINDOW_MS)));
    const maxPerWindow = Math.max(1, Math.trunc(Number(deps.maxPerWindow ?? DEFAULT_MAX_PER_WINDOW)));

    const requestId = normalizeRequestId(params.requestId);
    const key = illustId.toString();

    const quota = consumeQuota({
      state,
      key,
      now,
      dedupeTtlMs,
      windowMs,
      maxPerWindow,
    });

    if (!quota.ok) {
      return { scheduled: false, reason: quota.reason };
    }

    const enqueue = deps.enqueueHydrate ?? enqueueHydrateMetadata;
    try {
      const promise = requestId ? enqueue(illustId, requestId) : enqueue(illustId);
      void promise.catch(() => undefined);
      return { scheduled: true, reason: 'scheduled' };
    } catch {
      return { scheduled: false, reason: 'enqueue_failed' };
    }
  } catch {
    return { scheduled: false, reason: 'enqueue_failed' };
  }
}

