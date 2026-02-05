import { getEnv } from '../config/env';

type LimiterEntry = {
  inFlight: number;
  waiters: Array<() => void>;
  nextAt: number;
};

type ProxyRateLimiterState = Map<string, LimiterEntry>;

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatProxyRateLimiter: ProxyRateLimiterState | undefined;
}

function getProxyRateLimiterState(): ProxyRateLimiterState {
  globalThis.__pixivcatProxyRateLimiter ??= new Map<string, LimiterEntry>();
  return globalThis.__pixivcatProxyRateLimiter;
}

function normalizeId(value: unknown): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

function normalizeMaxInFlight(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return Number.POSITIVE_INFINITY;
  return n;
}

function normalizeIntervalMs(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquire(entry: LimiterEntry, maxInFlight: number): Promise<() => void> {
  if (entry.inFlight < maxInFlight) {
    entry.inFlight += 1;
    return () => release(entry);
  }

  await new Promise<void>((resolve) => entry.waiters.push(resolve));
  entry.inFlight += 1;
  return () => release(entry);
}

function release(entry: LimiterEntry): void {
  entry.inFlight = Math.max(0, entry.inFlight - 1);
  const next = entry.waiters.shift();
  if (next) next();
}

function getLimiterEntry(state: ProxyRateLimiterState, id: string): LimiterEntry {
  const existing = state.get(id);
  if (existing) return existing;
  const created: LimiterEntry = { inFlight: 0, waiters: [], nextAt: 0 };
  state.set(id, created);
  return created;
}

export async function withProxyRateLimit<T>(proxyId: string | undefined, fn: () => Promise<T>): Promise<T> {
  const id = normalizeId(proxyId);
  if (!id) return fn();

  const env = getEnv();
  const maxInFlight = normalizeMaxInFlight(env.PROXY_RATE_LIMIT_MAX_IN_FLIGHT_PER_PROXY);
  const minIntervalMs = normalizeIntervalMs(env.PROXY_RATE_LIMIT_PER_PROXY_MS);

  if (maxInFlight === Number.POSITIVE_INFINITY && minIntervalMs <= 0) {
    return fn();
  }

  const state = getProxyRateLimiterState();
  const entry = getLimiterEntry(state, id);

  const releaseFn = await acquire(entry, maxInFlight);

  try {
    const now = Date.now();
    const waitMs = entry.nextAt - now;
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    const startedAt = Date.now();
    entry.nextAt = startedAt + minIntervalMs;

    return await fn();
  } finally {
    releaseFn();
  }
}

export function resetProxyRateLimitForTest(): void {
  globalThis.__pixivcatProxyRateLimiter = undefined;
}

