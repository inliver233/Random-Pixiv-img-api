export type EasyProxiesAuthResult =
  | { ok: true; token: string | null; no_password: boolean }
  | { ok: false; status: number; error: string };

export type EasyProxiesExportResult =
  | { ok: true; lines: string[]; token: string | null }
  | { ok: false; status: number; error: string };

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

