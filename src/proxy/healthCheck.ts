import type { PrismaClient, ProxyEndpoint } from '@prisma/client';

import axios from 'axios';

import { getPrismaClient } from '../db/prismaClient';
import logger from '../logger/logger';

import { getProxyAgentPair } from './agentFactory';

export type ProxyHealthCandidate = {
  id: string;
  proxyUri: string;
};

export type ProxyProbeSample = {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  checkedAt: number;
};

export type ProxyHealthEntry = {
  id: string;
  status: 'unknown' | 'healthy' | 'warning' | 'error';
  lastOk: boolean | null;
  lastCheckedAt: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  samples: number;
  success: number;
  failure: number;
  successRate: number;
  avgLatencyMs: number | null;
  score: number;
};

export type ProxyHealthReport = {
  checkedAt: number;
  probeUrl: string;
  timeoutMs: number;
  total: number;
  healthy: number;
  minHealthy: number;
  ok: boolean;
  entries: ProxyHealthEntry[];
};

export type ProxyHealthOptions = {
  probeUrl: string;
  timeoutMs: number;
  intervalMs: number;
  minHealthy: number;
  minSuccessRate: number;
  maxLatencyMs: number;
  windowSize: number;
  maxConcurrency: number;
};

type ProxyHealthState = {
  samplesById: Map<string, ProxyProbeSample[]>;
  lastReport: ProxyHealthReport | null;
  timer: NodeJS.Timeout | null;
  inFlight: Promise<ProxyHealthReport> | null;
  schedulerRunParams: {
    prisma?: PrismaClient;
    candidates?: ProxyHealthCandidate[];
    options?: Partial<ProxyHealthOptions>;
    probeFn?: ProxyProbeFn;
  } | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatProxyHealthState: ProxyHealthState | undefined;
}

const DEFAULT_PROBE_URL = 'http://cp.cloudflare.com/generate_204';

function ensureState(): ProxyHealthState {
  globalThis.__pixivcatProxyHealthState ??= {
    samplesById: new Map<string, ProxyProbeSample[]>(),
    lastReport: null,
    timer: null,
    inFlight: null,
    schedulerRunParams: null,
  };
  return globalThis.__pixivcatProxyHealthState;
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

function coerceFloat(value: unknown, defaultValue: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return defaultValue;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return defaultValue;
}

function normalizeUrl(value: unknown, defaultValue: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return defaultValue;
  try {
    return new URL(raw).toString();
  } catch {
    return defaultValue;
  }
}

export function getProxyHealthOptions(overrides: Partial<ProxyHealthOptions> = {}): ProxyHealthOptions {
  const probeUrl = normalizeUrl(overrides.probeUrl ?? process.env.PROXY_HEALTH_PROBE_URL, DEFAULT_PROBE_URL);
  const timeoutMs = Math.max(1000, coerceInt(overrides.timeoutMs ?? process.env.PROXY_HEALTH_TIMEOUT_MS, 10_000));
  const intervalMs = Math.max(5_000, coerceInt(overrides.intervalMs ?? process.env.PROXY_HEALTH_INTERVAL_MS, 5 * 60_000));
  const minHealthy = Math.max(0, coerceInt(overrides.minHealthy ?? process.env.PROXY_HEALTH_MIN_AVAILABLE, 0));

  const minSuccessRateRaw = coerceFloat(overrides.minSuccessRate ?? process.env.PROXY_HEALTH_MIN_SUCCESS_RATE, 0.6);
  const minSuccessRate = Math.min(1, Math.max(0, minSuccessRateRaw));
  const maxLatencyMs = Math.max(0, coerceInt(overrides.maxLatencyMs ?? process.env.PROXY_HEALTH_MAX_LATENCY_MS, 5000));
  const windowSize = Math.max(1, coerceInt(overrides.windowSize ?? process.env.PROXY_HEALTH_WINDOW_SIZE, 5));
  const maxConcurrency = Math.max(1, coerceInt(overrides.maxConcurrency ?? process.env.PROXY_HEALTH_MAX_CONCURRENCY, 10));

  return {
    probeUrl,
    timeoutMs,
    intervalMs,
    minHealthy,
    minSuccessRate,
    maxLatencyMs,
    windowSize,
    maxConcurrency,
  };
}

function formatHostForUri(host: string): string {
  const h = String(host ?? '').trim();
  if (!h) throw new Error('Proxy host is required.');
  if (h.includes(':') && !h.startsWith('[') && !h.endsWith(']')) return `[${h}]`;
  return h;
}

type ProxyEndpointInput = Pick<ProxyEndpoint, 'id' | 'scheme' | 'host' | 'port' | 'username' | 'password'>;

function buildProxyUri(endpoint: ProxyEndpointInput): string {
  const scheme = String(endpoint.scheme ?? '').trim().toLowerCase();
  const host = formatHostForUri(String(endpoint.host ?? ''));
  const port = Number(endpoint.port);
  if (!scheme) throw new Error('Proxy scheme is required.');
  if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error('Proxy port is invalid.');

  const username = String(endpoint.username ?? '');
  const password = String(endpoint.password ?? '');
  const authNeeded = username !== '' || password !== '';
  const auth = authNeeded
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : '';

  return `${scheme}://${auth}${host}:${port}`;
}

async function loadEnabledProxyCandidates(prisma?: PrismaClient): Promise<ProxyHealthCandidate[]> {
  const client = prisma ?? getPrismaClient();
  const rows = await client.proxyEndpoint.findMany({
    where: { enabled: true },
    select: { id: true, scheme: true, host: true, port: true, username: true, password: true },
    orderBy: { id: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id.toString(),
    proxyUri: buildProxyUri(row as any),
  }));
}

function normalizeError(err: unknown): string {
  if (!err) return 'unknown_error';
  if (err instanceof Error) {
    const code = typeof (err as any).code === 'string' ? (err as any).code : '';
    const message = err.message || 'error';
    return code ? `${code}:${message}` : message;
  }
  return String(err);
}

export type ProxyProbeFn = (candidate: ProxyHealthCandidate, options: ProxyHealthOptions) => Promise<{
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}>;

async function defaultProbe(candidate: ProxyHealthCandidate, options: ProxyHealthOptions): Promise<{
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}> {
  const agents = getProxyAgentPair(candidate.proxyUri, { keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });
  const startedAt = process.hrtime.bigint();

  try {
    await axios.get(options.probeUrl, {
      timeout: options.timeoutMs,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      proxy: false,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    return { ok: true, latencyMs, error: null };
  } catch (err: unknown) {
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    return { ok: false, latencyMs, error: normalizeError(err) };
  }
}

function recordSample(state: ProxyHealthState, proxyId: string, sample: ProxyProbeSample, windowSize: number): void {
  const id = String(proxyId ?? '').trim();
  if (!id) return;

  const existing = state.samplesById.get(id) ?? [];
  existing.push(sample);
  while (existing.length > windowSize) existing.shift();
  state.samplesById.set(id, existing);
}

function computeHealthEntry(
  state: ProxyHealthState,
  proxyId: string,
  options: ProxyHealthOptions,
): ProxyHealthEntry {
  const samples = state.samplesById.get(proxyId) ?? [];
  if (samples.length === 0) {
    return {
      id: proxyId,
      status: 'unknown',
      lastOk: null,
      lastCheckedAt: null,
      lastLatencyMs: null,
      lastError: null,
      samples: 0,
      success: 0,
      failure: 0,
      successRate: 0,
      avgLatencyMs: null,
      score: 0,
    };
  }

  const last = samples[samples.length - 1]!;
  let success = 0;
  let latencySum = 0;
  let latencyCount = 0;
  for (const s of samples) {
    if (s.ok) {
      success += 1;
      if (typeof s.latencyMs === 'number' && Number.isFinite(s.latencyMs)) {
        latencySum += s.latencyMs;
        latencyCount += 1;
      }
    }
  }
  const failure = samples.length - success;
  const successRate = samples.length > 0 ? success / samples.length : 0;
  const avgLatencyMs = latencyCount > 0 ? latencySum / latencyCount : null;

  const latencyPenalty = avgLatencyMs === null ? 1 : 1 + avgLatencyMs / 1000;
  const score = latencyPenalty > 0 ? successRate / latencyPenalty : 0;

  const isHealthy =
    Boolean(last.ok)
    && successRate >= options.minSuccessRate
    && typeof last.latencyMs === 'number'
    && Number.isFinite(last.latencyMs)
    && last.latencyMs <= options.maxLatencyMs;

  const status: ProxyHealthEntry['status'] = (() => {
    if (isHealthy) return 'healthy';
    if (success > 0) return 'warning';
    return 'error';
  })();

  return {
    id: proxyId,
    status,
    lastOk: last.ok,
    lastCheckedAt: last.checkedAt,
    lastLatencyMs: last.latencyMs,
    lastError: last.error,
    samples: samples.length,
    success,
    failure,
    successRate,
    avgLatencyMs,
    score,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const run = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]!);
    }
  };

  const runners = Array.from({ length: Math.min(maxConcurrency, items.length) }, run);
  await Promise.all(runners);
  return results;
}

export async function runProxyHealthCheckOnce(params: {
  prisma?: PrismaClient;
  candidates?: ProxyHealthCandidate[];
  options?: Partial<ProxyHealthOptions>;
  probeFn?: ProxyProbeFn;
} = {}): Promise<ProxyHealthReport> {
  const state = ensureState();
  if (state.inFlight) return state.inFlight;

  const options = getProxyHealthOptions(params.options);
  state.inFlight = (async () => {
    const candidates = params.candidates ?? await loadEnabledProxyCandidates(params.prisma);
    const checkedAt = Date.now();
    const probe = params.probeFn ?? defaultProbe;

    await mapWithConcurrency(candidates, options.maxConcurrency, async (candidate) => {
      const probeRes = await probe(candidate, options);
      recordSample(
        state,
        candidate.id,
        {
          ok: probeRes.ok,
          latencyMs: probeRes.latencyMs,
          error: probeRes.error,
          checkedAt,
        },
        options.windowSize,
      );
    });

    const entries = candidates.map((c) => computeHealthEntry(state, c.id, options));
    const healthy = entries.filter((e) => e.status === 'healthy').length;
    const ok = healthy >= options.minHealthy;

    const report: ProxyHealthReport = {
      checkedAt,
      probeUrl: options.probeUrl,
      timeoutMs: options.timeoutMs,
      total: candidates.length,
      healthy,
      minHealthy: options.minHealthy,
      ok,
      entries: entries.sort((a, b) => {
        if (a.status === b.status) return b.score - a.score;
        if (a.status === 'healthy') return -1;
        if (b.status === 'healthy') return 1;
        if (a.status === 'unknown') return 1;
        if (b.status === 'unknown') return -1;
        return 0;
      }),
    };

    state.lastReport = report;
    return report;
  })()
    .catch((err: unknown) => {
      const message = normalizeError(err);
      logger.warn({ err: message }, 'proxy health check failed');
      const checkedAt = Date.now();
      const report: ProxyHealthReport = {
        checkedAt,
        probeUrl: options.probeUrl,
        timeoutMs: options.timeoutMs,
        total: 0,
        healthy: 0,
        minHealthy: options.minHealthy,
        ok: options.minHealthy === 0,
        entries: [],
      };
      state.lastReport = report;
      return report;
    })
    .finally(() => {
      state.inFlight = null;
    });

  return state.inFlight;
}

export function getProxyHealthReport(): ProxyHealthReport | null {
  return ensureState().lastReport;
}

export function filterProxyCandidatesByHealth<T extends { id: string }>(
  candidates: T[],
  options: Partial<ProxyHealthOptions> = {},
): T[] {
  const state = ensureState();
  const resolved = getProxyHealthOptions(options);

  const withScore = candidates
    .map((c, idx) => {
      const entry = computeHealthEntry(state, c.id, resolved);
      return { candidate: c, entry, idx };
    })
    .filter((row) => row.entry.status === 'healthy' || row.entry.status === 'unknown')
    .sort((a, b) => {
      const aRank = a.entry.status === 'healthy' ? 0 : 1;
      const bRank = b.entry.status === 'healthy' ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;
      if (aRank === 1) return a.idx - b.idx; // keep original order for unknowns
      const scoreDiff = b.entry.score - a.entry.score;
      if (scoreDiff !== 0) return scoreDiff;
      return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;
    });

  return withScore.map((row) => row.candidate);
}

export function ensureProxyHealthSchedulerStarted(params: {
  allowInTest?: boolean;
  prisma?: PrismaClient;
  candidates?: ProxyHealthCandidate[];
  options?: Partial<ProxyHealthOptions>;
  probeFn?: ProxyProbeFn;
} = {}): void {
  const allowInTest = Boolean(params.allowInTest);
  if (!allowInTest && process.env.NODE_ENV === 'test') return;

  const state = ensureState();
  if (state.timer) return;

  const options = params.options ?? {};
  state.schedulerRunParams = {
    prisma: params.prisma,
    candidates: params.candidates,
    options,
    probeFn: params.probeFn,
  };

  const resolved = getProxyHealthOptions(options);
  state.timer = setInterval(() => {
    void runProxyHealthCheckOnce(state.schedulerRunParams ?? {});
  }, resolved.intervalMs);

  // Initial run (do not await to keep startup non-blocking).
  void runProxyHealthCheckOnce(state.schedulerRunParams ?? {});
}

export function stopProxyHealthSchedulerForTest(): void {
  const state = ensureState();
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

export function resetProxyHealthForTest(): void {
  globalThis.__pixivcatProxyHealthState = undefined;
}
