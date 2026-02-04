import type { NextFunction, Request, Response } from 'express';
import net from 'node:net';

function getRequestId(req: Request, res: Response): string | undefined {
  return (req as any).request_id || res.locals.request_id;
}

type AdminIpAllowlist = {
  raw: string;
  exact: Set<string>;
  cidr4: Array<{ network: number; mask: number }>;
};

type AdminIpAllowlistState = {
  raw: string | null;
  parsed: AdminIpAllowlist | null;
  error: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatAdminIpAllowlist: AdminIpAllowlistState | undefined;
}

function ensureAdminIpAllowlistState(): AdminIpAllowlistState {
  globalThis.__pixivcatAdminIpAllowlist ??= {
    raw: null,
    parsed: null,
    error: null,
  };

  return globalThis.__pixivcatAdminIpAllowlist;
}

function parseBooleanEnv(value: unknown, defaultValue: boolean): boolean {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function hasAdminSessionSecret(): boolean {
  const secret = String(process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_TOKEN || '').trim();
  return secret.length > 0;
}

function isAdminSessionAuthEnabled(): boolean {
  if (!parseBooleanEnv(process.env.ADMIN_SESSION_AUTH_ENABLED, false)) return false;
  return hasAdminSessionSecret();
}

function isAdminSessionAuthenticated(req: Request): boolean {
  return Boolean((req as any)?.session?.admin);
}

function normalizeIp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withoutZone = trimmed.split('%')[0] ?? trimmed;
  const lowered = withoutZone.toLowerCase();
  if (lowered.startsWith('::ffff:')) {
    const v4 = withoutZone.slice('::ffff:'.length);
    if (net.isIP(v4) === 4) return v4;
  }

  return withoutZone;
}

function toIpv4Int(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 255)) return null;

  return ((nums[0]! << 24) | (nums[1]! << 16) | (nums[2]! << 8) | nums[3]!) >>> 0;
}

function parseCidr4(token: string): { network: number; mask: number } | null {
  const [ip, prefixRaw] = token.split('/');
  if (!ip || prefixRaw === undefined) return null;
  if (net.isIP(ip) !== 4) return null;

  const prefix = Number(prefixRaw);
  if (!Number.isFinite(prefix) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;

  const network = toIpv4Int(ip);
  if (network === null) return null;

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: network & mask, mask };
}

function parseAdminIpAllowlist(raw: string): { ok: true; allowlist: AdminIpAllowlist } | { ok: false; error: string } {
  const tokens = raw
    .split(/[,\s|]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return { ok: false, error: 'ADMIN_IP_ALLOWLIST is set but empty.' };
  }

  const exact = new Set<string>();
  const cidr4: Array<{ network: number; mask: number }> = [];

  for (const token of tokens) {
    if (token.includes('/')) {
      const parsed = parseCidr4(token);
      if (!parsed) return { ok: false, error: `Invalid IPv4 CIDR: ${token}` };
      cidr4.push(parsed);
      continue;
    }

    const normalized = normalizeIp(token);
    if (!normalized) return { ok: false, error: `Invalid IP: ${token}` };
    const kind = net.isIP(normalized);
    if (!kind) return { ok: false, error: `Invalid IP: ${token}` };
    exact.add(normalized);
  }

  return { ok: true, allowlist: { raw, exact, cidr4 } };
}

function getClientIp(req: Request): string | null {
  const ips = (req as any).ips;
  if (Array.isArray(ips) && ips.length > 0) {
    return normalizeIp(ips[0]);
  }

  return normalizeIp(req.ip);
}

function isAdminIpAllowed(req: Request): { ok: true } | { ok: false; code: 'ADMIN_IP_DENIED' | 'ADMIN_IP_ALLOWLIST_INVALID'; message: string } {
  const raw = String(process.env.ADMIN_IP_ALLOWLIST || '').trim();
  if (!raw) return { ok: true };

  const state = ensureAdminIpAllowlistState();
  if (state.raw !== raw) {
    const parsed = parseAdminIpAllowlist(raw);
    state.raw = raw;
    state.parsed = parsed.ok ? parsed.allowlist : null;
    state.error = parsed.ok ? null : parsed.error;
  }

  if (state.error) {
    return { ok: false, code: 'ADMIN_IP_ALLOWLIST_INVALID', message: state.error };
  }

  const allowlist = state.parsed;
  if (!allowlist) return { ok: false, code: 'ADMIN_IP_ALLOWLIST_INVALID', message: 'Invalid ADMIN_IP_ALLOWLIST.' };

  const ip = getClientIp(req);
  if (!ip) return { ok: false, code: 'ADMIN_IP_DENIED', message: 'Missing client IP.' };

  if (allowlist.exact.has(ip)) return { ok: true };
  if ((ip === '127.0.0.1' && allowlist.exact.has('::1')) || (ip === '::1' && allowlist.exact.has('127.0.0.1'))) {
    return { ok: true };
  }

  if (net.isIP(ip) === 4) {
    const ipInt = toIpv4Int(ip);
    if (ipInt === null) return { ok: false, code: 'ADMIN_IP_DENIED', message: 'Invalid client IPv4.' };

    for (const entry of allowlist.cidr4) {
      if ((ipInt & entry.mask) === entry.network) return { ok: true };
    }
  }

  return { ok: false, code: 'ADMIN_IP_DENIED', message: `IP not allowed: ${ip}` };
}

function parseCookie(header: string, name: string): string | null {
  if (!header) return null;

  const parts = header.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (key !== name) continue;

    const rawValue = trimmed.slice(eq + 1).trim();
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function setAdminTokenCookie(req: Request, res: Response, token: string) {
  const encoded = encodeURIComponent(token);

  // Limit the cookie to /admin to reduce accidental leakage to public endpoints.
  // Keep it httpOnly since this is a privileged token.
  const parts = [
    `admin_token=${encoded}`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Strict',
    // 7 days
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];

  // Only mark Secure when the current request is HTTPS (or proxied HTTPS).
  // This avoids the common "login works but assets 401" issue when someone tests over plain HTTP.
  if (req.secure) {
    parts.push('Secure');
  }

  res.append('Set-Cookie', parts.join('; '));
}

function extractToken(req: Request): string | null {
  const auth = req.header('authorization') || '';
  const normalized = auth.trim();
  if (normalized.toLowerCase().startsWith('bearer ')) {
    const token = normalized.slice(7).trim();
    return token ? token : null;
  }

  const headerToken = req.header('x-admin-token');
  if (headerToken && headerToken.trim()) return headerToken.trim();

  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();

  const cookieToken = parseCookie(req.header('cookie') || '', 'admin_token');
  if (cookieToken && cookieToken.trim()) return cookieToken.trim();

  return null;
}

export default function adminAuth(req: Request, res: Response, next: NextFunction) {
  const ipCheck = isAdminIpAllowed(req);
  if (!ipCheck.ok) {
    const accept = (req.header('accept') || '').toLowerCase();
    const wantsHtml = accept.includes('text/html');

    res.setHeader('Cache-Control', 'no-store');

    if (wantsHtml) {
      res.status(ipCheck.code === 'ADMIN_IP_DENIED' ? 403 : 503).type('html').send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>后台访问受限</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 2rem; line-height: 1.4; }
      code { background: #f4f4f5; padding: 0.1rem 0.3rem; border-radius: 4px; }
      .box { max-width: 720px; padding: 1rem 1.25rem; border: 1px solid #e4e4e7; border-radius: 10px; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>${ipCheck.code === 'ADMIN_IP_DENIED' ? '禁止访问' : '后台配置错误'}</h1>
      <p>${ipCheck.message}</p>
    </div>
  </body>
</html>`);
      return;
    }

    res.status(ipCheck.code === 'ADMIN_IP_DENIED' ? 403 : 503).json({
      code: ipCheck.code,
      message: ipCheck.message,
      request_id: getRequestId(req, res),
    });
    return;
  }

  const sessionEnabled = isAdminSessionAuthEnabled();
  if (sessionEnabled) {
    const path = String(req.path || '');
    if (path === '/login' || path === '/logout') {
      next();
      return;
    }

    if (isAdminSessionAuthenticated(req)) {
      next();
      return;
    }
  }

  const expected = String(process.env.ADMIN_TOKEN || '').trim();
  const provided = extractToken(req);

  if (!expected || !provided || provided !== expected) {
    const accept = (req.header('accept') || '').toLowerCase();
    const wantsHtml = accept.includes('text/html');

    res.setHeader('Cache-Control', 'no-store');

    if (wantsHtml) {
      res.status(401).type('html').send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>后台未授权</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 2rem; line-height: 1.4; }
      code { background: #f4f4f5; padding: 0.1rem 0.3rem; border-radius: 4px; }
      .box { max-width: 720px; padding: 1rem 1.25rem; border: 1px solid #e4e4e7; border-radius: 10px; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>未授权</h1>
      <p>该页面受保护。请在请求中携带 <code>Authorization: Bearer &lt;ADMIN_TOKEN&gt;</code>，或先打开：</p>
      <p><code>/admin?token=&lt;ADMIN_TOKEN&gt;</code></p>
    </div>
  </body>
</html>`);
      return;
    }

    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
      request_id: getRequestId(req, res),
    });
    return;
  }

  if (typeof req.query?.token === 'string') {
    // First-time browser access: persist token as cookie to allow subsequent asset/API requests.
    setAdminTokenCookie(req, res, provided);

    if (req.method === 'GET') {
      // Redirect to the same path without the token query param to keep it out of the URL bar.
      const u = new URL(`http://localhost${req.originalUrl}`);
      u.searchParams.delete('token');
      res.redirect(302, `${u.pathname}${u.search}`);
      return;
    }
  }

  next();
}
