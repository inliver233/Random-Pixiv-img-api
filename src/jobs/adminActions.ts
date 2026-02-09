import logger from '../logger/logger';
import { auditAdminModelChange } from '../audit/adminAudit';
import { getPrismaClient } from '../db/prismaClient';
import { runProxyHealthCheckOnce } from '../proxy/healthCheck';
import { enqueue, ensureQueue, startQueue } from '../queue/queue';
import { testRefreshToken } from '../services/pixivAuthService';

const ADMIN_PIXIV_TOKEN_TEST_REFRESH_JOB = 'admin_pixiv_token_test_refresh';
const ADMIN_PROXY_ENDPOINT_PROBE_JOB = 'admin_proxy_endpoint_probe';

type AdminPixivTokenTestRefreshJobData = {
  token_id: string;
  request_id?: string;
  actor?: string;
};

type AdminProxyEndpointProbeJobData = {
  endpoint_id: string;
  request_id?: string;
  actor?: string;
};

function normalizeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v ? v : undefined;
}

function normalizeActor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v ? v : undefined;
}

function unwrapAdminJsIdShape(value: unknown): unknown {
  let current: unknown = value;
  for (let i = 0; i < 4; i += 1) {
    if (!current || typeof current !== 'object') break;

    if ('id' in (current as any)) {
      current = (current as any).id;
      continue;
    }

    if ('value' in (current as any)) {
      current = (current as any).value;
      continue;
    }

    const params = (current as any).params;
    if (params && typeof params === 'object' && 'id' in (params as any)) {
      current = (params as any).id;
      continue;
    }

    break;
  }
  return current;
}

export type AdminJobBigIntIdParseResult =
  | { ok: true; id: bigint }
  | { ok: false; code: string; message: string };

export function parseAdminJobBigIntId(value: unknown, label: 'token_id' | 'endpoint_id'): AdminJobBigIntIdParseResult {
  const normalized = unwrapAdminJsIdShape(value);
  let asBigInt: bigint | null = null;
  try {
    if (typeof normalized === 'bigint') asBigInt = normalized;
    else if (typeof normalized === 'number' && Number.isFinite(normalized)) asBigInt = BigInt(Math.trunc(normalized));
    else if (typeof normalized === 'string' && normalized.trim()) asBigInt = BigInt(normalized.trim());
  } catch {
    asBigInt = null;
  }

  if (asBigInt === null || asBigInt <= 0n) {
    return {
      ok: false,
      code: `invalid_${label}`,
      message: `Invalid ${label} (expected string/number/bigint/{id}/{value}/{params.id}).`,
    };
  }

  return { ok: true, id: asBigInt };
}

function runWithTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<{ status: 'ok'; value: T } | { status: 'timeout' } | { status: 'error'; error: string }> {
  const timeout = Math.max(1, Math.trunc(timeoutMs));
  const timer = new Promise<{ status: 'timeout' }>((resolve) => {
    setTimeout(() => resolve({ status: 'timeout' }), timeout);
  });

  return Promise.race([
    work.then((value) => ({ status: 'ok' as const, value })),
    timer,
  ]).catch((err: unknown) => ({ status: 'error' as const, error: err instanceof Error ? err.message : String(err) }));
}

function buildProxyUri(params: { scheme: string; host: string; port: number; username: string; password: string }): string {
  const formatHostForUri = (host: string): string => {
    const trimmed = String(host ?? '').trim();
    if (!trimmed) throw new Error('proxy host is empty');
    if (trimmed.includes(':') && !trimmed.startsWith('[') && !trimmed.endsWith(']')) return `[${trimmed}]`;
    return trimmed;
  };

  const scheme = String(params.scheme ?? '').trim().toLowerCase();
  const host = formatHostForUri(String(params.host ?? ''));
  const port = Number(params.port);
  if (!scheme) throw new Error('proxy scheme is empty');
  if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error('proxy port is invalid');

  const username = String(params.username ?? '');
  const password = String(params.password ?? '');
  const authNeeded = username !== '' || password !== '';
  const auth = authNeeded
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : '';
  return `${scheme}://${auth}${host}:${port}`;
}

export function getAdminActionQueueNames(): string[] {
  return [ADMIN_PIXIV_TOKEN_TEST_REFRESH_JOB, ADMIN_PROXY_ENDPOINT_PROBE_JOB];
}

export async function enqueueAdminPixivTokenTestRefresh(params: {
  tokenId: bigint;
  requestId?: string;
  actor?: string;
}): Promise<string> {
  const payload: AdminPixivTokenTestRefreshJobData = { token_id: params.tokenId.toString() };
  const requestId = normalizeRequestId(params.requestId);
  const actor = normalizeActor(params.actor);
  if (requestId) payload.request_id = requestId;
  if (actor) payload.actor = actor;
  return enqueue<AdminPixivTokenTestRefreshJobData>(ADMIN_PIXIV_TOKEN_TEST_REFRESH_JOB, payload);
}

export async function enqueueAdminProxyEndpointProbe(params: {
  endpointId: bigint;
  requestId?: string;
  actor?: string;
}): Promise<string> {
  const payload: AdminProxyEndpointProbeJobData = { endpoint_id: params.endpointId.toString() };
  const requestId = normalizeRequestId(params.requestId);
  const actor = normalizeActor(params.actor);
  if (requestId) payload.request_id = requestId;
  if (actor) payload.actor = actor;
  return enqueue<AdminProxyEndpointProbeJobData>(ADMIN_PROXY_ENDPOINT_PROBE_JOB, payload);
}

async function registerPixivTokenTestRefreshWorker(): Promise<void> {
  const boss = await startQueue();
  if (!boss) return;

  await ensureQueue(ADMIN_PIXIV_TOKEN_TEST_REFRESH_JOB);

  await boss.work(ADMIN_PIXIV_TOKEN_TEST_REFRESH_JOB, async (job: any) => {
    const jobData: any = job?.data ?? {};
    const tokenIdRaw = jobData.token_id ?? jobData.tokenId ?? jobData.id;
    const requestId = normalizeRequestId(jobData.request_id ?? jobData.requestId);
    const actor = normalizeActor(jobData.actor);

    const tokenIdResult = parseAdminJobBigIntId(tokenIdRaw, 'token_id');
    if (!tokenIdResult.ok) {
      auditAdminModelChange({
        action: 'pixiv_token_test_refresh_fail',
        resource: 'PixivToken',
        record_id: undefined,
        req: { request_id: requestId, session: { admin_user: actor }, headers: { 'user-agent': 'admin_job_worker' } },
        detail: { ok: false, code: tokenIdResult.code, message: tokenIdResult.message, job_id: job?.id ?? null },
      });
      return { ok: false, code: tokenIdResult.code, message: tokenIdResult.message, token_id: null };
    }

    const tokenId = tokenIdResult.id;
    const prisma = getPrismaClient();

    const token = await prisma.pixivToken.findUnique({
      where: { id: tokenId },
      select: { id: true, enabled: true, label: true, refreshToken: true, refreshTokenMasked: true },
    });

    if (!token) {
      const message = 'token_not_found';
      auditAdminModelChange({
        action: 'pixiv_token_test_refresh_fail',
        resource: 'PixivToken',
        record_id: tokenId.toString(),
        req: { request_id: requestId, session: { admin_user: actor }, headers: { 'user-agent': 'admin_job_worker' } },
        detail: { ok: false, code: message, message, job_id: job?.id ?? null },
      });
      return { ok: false, code: message, message, token_id: tokenId.toString() };
    }

    if (!token.enabled) {
      const message = 'token_disabled';
      auditAdminModelChange({
        action: 'pixiv_token_test_refresh_fail',
        resource: 'PixivToken',
        record_id: token.id.toString(),
        req: { request_id: requestId, session: { admin_user: actor }, headers: { 'user-agent': 'admin_job_worker' } },
        detail: { ok: false, code: message, message, job_id: job?.id ?? null, label: token.label ?? null, refreshTokenMasked: token.refreshTokenMasked },
      });
      return { ok: false, code: message, message, token_id: token.id.toString() };
    }

    const result = await testRefreshToken(token.refreshToken);

    auditAdminModelChange({
      action: result.ok ? 'pixiv_token_test_refresh_ok' : 'pixiv_token_test_refresh_fail',
      resource: 'PixivToken',
      record_id: token.id.toString(),
      req: { request_id: requestId, session: { admin_user: actor }, headers: { 'user-agent': 'admin_job_worker' } },
      detail: {
        ok: result.ok,
        job_id: job?.id ?? null,
        label: token.label ?? null,
        refreshTokenMasked: token.refreshTokenMasked,
        status: result.ok ? 200 : result.status ?? null,
        code: result.ok ? null : result.code,
        message: result.ok ? null : result.message,
        expires_in: result.ok ? result.expires_in : null,
      },
    });

    return result.ok
      ? { ok: true, token_id: token.id.toString(), expires_in: result.expires_in }
      : { ok: false, token_id: token.id.toString(), status: result.status ?? null, code: result.code, message: result.message };
  });
}

async function registerProxyEndpointProbeWorker(): Promise<void> {
  const boss = await startQueue();
  if (!boss) return;

  await ensureQueue(ADMIN_PROXY_ENDPOINT_PROBE_JOB);

  await boss.work(ADMIN_PROXY_ENDPOINT_PROBE_JOB, async (job: any) => {
    const jobData: any = job?.data ?? {};
    const endpointIdRaw = jobData.endpoint_id ?? jobData.endpointId ?? jobData.id;
    const requestId = normalizeRequestId(jobData.request_id ?? jobData.requestId);
    const actor = normalizeActor(jobData.actor);

    const endpointIdResult = parseAdminJobBigIntId(endpointIdRaw, 'endpoint_id');
    if (!endpointIdResult.ok) {
      auditAdminModelChange({
        action: 'proxy_endpoint_probe_error',
        resource: 'ProxyEndpoint',
        record_id: undefined,
        req: { request_id: requestId, session: { admin_user: actor }, headers: { 'user-agent': 'admin_job_worker' } },
        detail: { ok: false, code: endpointIdResult.code, message: endpointIdResult.message, job_id: job?.id ?? null },
      });
      return { ok: false, code: endpointIdResult.code, message: endpointIdResult.message, endpoint_id: null };
    }

    const endpointId = endpointIdResult.id;
    const prisma = getPrismaClient();

    const endpoint = await prisma.proxyEndpoint.findUnique({
      where: { id: endpointId },
      select: { id: true, enabled: true, scheme: true, host: true, port: true, username: true, password: true },
    });

    if (!endpoint) {
      const message = 'proxy_endpoint_not_found';
      auditAdminModelChange({
        action: 'proxy_endpoint_probe_error',
        resource: 'ProxyEndpoint',
        record_id: endpointId.toString(),
        req: { request_id: requestId, session: { admin_user: actor }, headers: { 'user-agent': 'admin_job_worker' } },
        detail: { ok: false, code: message, message, job_id: job?.id ?? null },
      });
      return { ok: false, code: message, message, endpoint_id: endpointId.toString() };
    }

    const proxyUri = buildProxyUri({
      scheme: String(endpoint.scheme ?? ''),
      host: String(endpoint.host ?? ''),
      port: endpoint.port,
      username: String(endpoint.username ?? ''),
      password: String(endpoint.password ?? ''),
    });

    const probeTimeoutMs = Math.max(
      1_500,
      Math.min(
        12_000,
        Number.parseInt(String(process.env.ADMIN_PROXY_PROBE_TIMEOUT_MS ?? '4500'), 10) || 4_500,
      ),
    );

    const probeResult = await runWithTimeout(
      runProxyHealthCheckOnce({
        candidates: [{ id: endpoint.id.toString(), proxyUri }],
        options: {
          maxConcurrency: 1,
          minHealthy: 0,
          windowSize: 1,
          timeoutMs: probeTimeoutMs,
        },
      }),
      probeTimeoutMs + 500,
    );

    if (probeResult.status === 'timeout') {
      auditAdminModelChange({
        action: 'proxy_endpoint_probe_timeout',
        resource: 'ProxyEndpoint',
        record_id: endpoint.id.toString(),
        req: { request_id: requestId, session: { admin_user: actor }, headers: { 'user-agent': 'admin_job_worker' } },
        detail: { timeoutMs: probeTimeoutMs, job_id: job?.id ?? null },
      });
      return { ok: false, endpoint_id: endpoint.id.toString(), status: 'timeout', timeout_ms: probeTimeoutMs };
    }

    if (probeResult.status === 'error') {
      const message = probeResult.error || 'probe_error';
      auditAdminModelChange({
        action: 'proxy_endpoint_probe_error',
        resource: 'ProxyEndpoint',
        record_id: endpoint.id.toString(),
        req: { request_id: requestId, session: { admin_user: actor }, headers: { 'user-agent': 'admin_job_worker' } },
        detail: { error: message, job_id: job?.id ?? null },
      });
      return { ok: false, endpoint_id: endpoint.id.toString(), status: 'error', message };
    }

    const report = probeResult.value;
    const entry = report.entries.find((e) => e.id === endpoint.id.toString()) ?? null;

    const ok = Boolean(entry?.lastOk);
    const status = entry?.status ?? 'unknown';
    const latencyMs = entry?.lastLatencyMs;
    const error = entry?.lastError;

    auditAdminModelChange({
      action: ok ? 'proxy_endpoint_probe_ok' : 'proxy_endpoint_probe_fail',
      resource: 'ProxyEndpoint',
      record_id: endpoint.id.toString(),
      req: { request_id: requestId, session: { admin_user: actor }, headers: { 'user-agent': 'admin_job_worker' } },
      detail: {
        enabled: endpoint.enabled,
        status,
        latencyMs: typeof latencyMs === 'number' && Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
        error,
        probeUrl: report.probeUrl,
        timeoutMs: report.timeoutMs,
        job_id: job?.id ?? null,
      },
    });

    return {
      ok,
      endpoint_id: endpoint.id.toString(),
      status,
      latency_ms: typeof latencyMs === 'number' && Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
      error: error ?? null,
    };
  });
}

export async function registerAdminActionsWorker(): Promise<void> {
  try {
    await Promise.all([
      registerPixivTokenTestRefreshWorker(),
      registerProxyEndpointProbeWorker(),
    ]);
  } catch (err: unknown) {
    logger.error({ err }, 'register admin actions worker failed');
    throw err;
  }
}
