export type EasyProxiesAuthResult =
  | { ok: true; token: string | null; no_password: boolean }
  | { ok: false; status: number; error: string };

export type EasyProxiesExportResult =
  | { ok: true; lines: string[]; token: string | null }
  | { ok: false; status: number; error: string };

export type EasyProxiesNodeSnapshot = {
  tag: string;
  name: string;
  mode: string;
  port?: number;
  region?: string;
  country?: string;
  last_latency_ms?: number;
  available?: boolean;
  initial_check_done?: boolean;
  blacklisted?: boolean;
  failure_count?: number;
  success_count?: number;
};

export type EasyProxiesNodesResult =
  | {
      ok: true;
      baseUrl: string;
      nodes: EasyProxiesNodeSnapshot[];
      total_nodes: number;
      region_stats: Record<string, number>;
      region_healthy: Record<string, number>;
      token: string | null;
    }
  | { ok: false; baseUrl: string; status: number; error: string };

export type EasyProxiesDebugNode = {
  tag: string;
  name: string;
  mode: string;
  port?: number;
  failure_count?: number;
  success_count?: number;
  active_connections?: number;
  last_latency_ms?: number;
  last_success?: string;
  last_failure?: string;
  last_error?: string;
  blacklisted?: boolean;
};

export type EasyProxiesDebugResult =
  | {
      ok: true;
      baseUrl: string;
      nodes: EasyProxiesDebugNode[];
      total_calls: number;
      total_success: number;
      success_rate: number;
      token: string | null;
    }
  | { ok: false; baseUrl: string; status: number; error: string };

type FetchLike = typeof fetch;

function normalizeBaseUrl(baseUrl: string): string {
  const raw = String(baseUrl ?? '').trim();
  if (!raw) throw new Error('easy_proxies baseUrl is required.');
  const u = new URL(raw);
  // Keep origin only (strip path/query/hash) so endpoint joining is predictable.
  return u.origin;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function safeReadJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function easyProxiesAuth(params: {
  baseUrl: string;
  password?: string;
  fetch?: FetchLike;
}): Promise<EasyProxiesAuthResult> {
  const base = normalizeBaseUrl(params.baseUrl);
  const f = params.fetch ?? fetch;

  const password = typeof params.password === 'string' ? params.password : '';
  if (!password) {
    return { ok: true, token: null, no_password: true };
  }

  const url = new URL('/api/auth', base);
  const res = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    const text = await safeReadText(res);
    return { ok: false, status: res.status, error: text || `easy_proxies auth failed: ${res.status}` };
  }

  const json = (await res.json().catch(() => null)) as any;
  if (json?.no_password) {
    return { ok: true, token: null, no_password: true };
  }

  const token = typeof json?.token === 'string' ? json.token.trim() : '';
  if (!token) {
    return { ok: false, status: 500, error: 'easy_proxies auth response missing token.' };
  }

  return { ok: true, token, no_password: false };
}

export async function easyProxiesExport(params: {
  baseUrl: string;
  password?: string;
  token?: string;
  fetch?: FetchLike;
}): Promise<EasyProxiesExportResult> {
  const base = normalizeBaseUrl(params.baseUrl);
  const f = params.fetch ?? fetch;

  let token = typeof params.token === 'string' && params.token.trim() ? params.token.trim() : null;
  if (!token && typeof params.password === 'string' && params.password.trim()) {
    const auth = await easyProxiesAuth({ baseUrl: base, password: params.password, fetch: f });
    if (!auth.ok) return auth;
    token = auth.token;
  }

  const url = new URL('/api/export', base);
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await f(url, { method: 'GET', headers });
  if (!res.ok) {
    const text = await safeReadText(res);
    return { ok: false, status: res.status, error: text || `easy_proxies export failed: ${res.status}` };
  }

  const text = await res.text();
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return { ok: true, lines, token };
}

export async function easyProxiesNodes(params: {
  baseUrl: string;
  password?: string;
  token?: string;
  fetch?: FetchLike;
}): Promise<EasyProxiesNodesResult> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const f = params.fetch ?? fetch;

  let token = typeof params.token === 'string' && params.token.trim() ? params.token.trim() : null;
  if (!token && typeof params.password === 'string' && params.password.trim()) {
    const auth = await easyProxiesAuth({ baseUrl, password: params.password, fetch: f });
    if (!auth.ok) return { ok: false, baseUrl, status: auth.status, error: auth.error };
    token = auth.token;
  }

  const url = new URL('/api/nodes', baseUrl);
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await f(url, { method: 'GET', headers });
  if (!res.ok) {
    const text = await safeReadText(res);
    return { ok: false, baseUrl, status: res.status, error: text || `easy_proxies nodes failed: ${res.status}` };
  }

  const json = await safeReadJson(res);
  const nodes = Array.isArray(json?.nodes) ? json.nodes : [];
  const totalNodes = Number(json?.total_nodes ?? nodes.length);
  const regionStats = json?.region_stats && typeof json.region_stats === 'object' ? json.region_stats : {};
  const regionHealthy = json?.region_healthy && typeof json.region_healthy === 'object' ? json.region_healthy : {};

  return {
    ok: true,
    baseUrl,
    nodes: nodes as any,
    total_nodes: Number.isFinite(totalNodes) ? totalNodes : nodes.length,
    region_stats: regionStats as any,
    region_healthy: regionHealthy as any,
    token,
  };
}

export async function easyProxiesDebug(params: {
  baseUrl: string;
  password?: string;
  token?: string;
  fetch?: FetchLike;
}): Promise<EasyProxiesDebugResult> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const f = params.fetch ?? fetch;

  let token = typeof params.token === 'string' && params.token.trim() ? params.token.trim() : null;
  if (!token && typeof params.password === 'string' && params.password.trim()) {
    const auth = await easyProxiesAuth({ baseUrl, password: params.password, fetch: f });
    if (!auth.ok) return { ok: false, baseUrl, status: auth.status, error: auth.error };
    token = auth.token;
  }

  const url = new URL('/api/debug', baseUrl);
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await f(url, { method: 'GET', headers });
  if (!res.ok) {
    const text = await safeReadText(res);
    return { ok: false, baseUrl, status: res.status, error: text || `easy_proxies debug failed: ${res.status}` };
  }

  const json = await safeReadJson(res);
  const nodes = Array.isArray(json?.nodes) ? json.nodes : [];
  const totalCalls = Number(json?.total_calls ?? 0);
  const totalSuccess = Number(json?.total_success ?? 0);
  const successRate = Number(json?.success_rate ?? 0);

  return {
    ok: true,
    baseUrl,
    nodes: nodes as any,
    total_calls: Number.isFinite(totalCalls) ? totalCalls : 0,
    total_success: Number.isFinite(totalSuccess) ? totalSuccess : 0,
    success_rate: Number.isFinite(successRate) ? successRate : 0,
    token,
  };
}
