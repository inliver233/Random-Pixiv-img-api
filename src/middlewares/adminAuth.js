const net = require('node:net');

function getRequestId(req, res) {
  return req.request_id || (res.locals && res.locals.request_id);
}

function ensureAdminIpAllowlistState() {
  // eslint-disable-next-line no-underscore-dangle
  globalThis.__pixivcatAdminIpAllowlist ??= {
    raw: null,
    parsed: null,
    error: null,
  };

  // eslint-disable-next-line no-underscore-dangle
  return globalThis.__pixivcatAdminIpAllowlist;
}

function parseBooleanEnv(value, defaultValue) {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function isAdminSessionAuthEnabled() {
  return parseBooleanEnv(process.env.ADMIN_SESSION_AUTH_ENABLED, false);
}

function isAdminSessionAuthenticated(req) {
  return Boolean(req && req.session && req.session.admin);
}

function normalizeIp(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withoutZone = trimmed.split('%')[0] || trimmed;
  const lowered = withoutZone.toLowerCase();
  if (lowered.startsWith('::ffff:')) {
    const v4 = withoutZone.slice('::ffff:'.length);
    if (net.isIP(v4) === 4) return v4;
  }

  return withoutZone;
}

function toIpv4Int(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 255)) return null;

  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

function parseCidr4(token) {
  const parts = token.split('/');
  const ip = parts[0];
  const prefixRaw = parts[1];
  if (!ip || prefixRaw === undefined) return null;
  if (net.isIP(ip) !== 4) return null;

  const prefix = Number(prefixRaw);
  if (!Number.isFinite(prefix) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;

  const network = toIpv4Int(ip);
  if (network === null) return null;

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: network & mask, mask };
}

function parseAdminIpAllowlist(raw) {
  const tokens = raw
    .split(/[,\s|]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return { ok: false, error: 'ADMIN_IP_ALLOWLIST is set but empty.' };
  }

  const exact = new Set();
  const cidr4 = [];

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

function getClientIp(req) {
  if (Array.isArray(req.ips) && req.ips.length > 0) {
    return normalizeIp(req.ips[0]);
  }

  return normalizeIp(req.ip);
}

function isAdminIpAllowed(req) {
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

function parseCookie(header, name) {
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

function setAdminTokenCookie(res, token) {
  const encoded = encodeURIComponent(token);
  const parts = [
    `admin_token=${encoded}`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  res.append('Set-Cookie', parts.join('; '));
}

function extractToken(req) {
  const auth = (req.get('authorization') || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    return token || null;
  }

  const headerToken = req.get('x-admin-token');
  if (headerToken && headerToken.trim()) return headerToken.trim();

  const queryToken = req.query && req.query.token;
  if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();

  const cookieToken = parseCookie(req.get('cookie') || '', 'admin_token');
  if (cookieToken && cookieToken.trim()) return cookieToken.trim();

  return null;
}

function adminAuth(req, res, next) {
  const ipCheck = isAdminIpAllowed(req);
  if (!ipCheck.ok) {
    const accept = String(req.get('accept') || '').toLowerCase();
    const wantsHtml = accept.includes('text/html');

    res.set('Cache-Control', 'no-store');

    if (wantsHtml) {
      res.status(ipCheck.code === 'ADMIN_IP_DENIED' ? 403 : 503).type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin Forbidden</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 2rem; line-height: 1.4; }
      code { background: #f4f4f5; padding: 0.1rem 0.3rem; border-radius: 4px; }
      .box { max-width: 720px; padding: 1rem 1.25rem; border: 1px solid #e4e4e7; border-radius: 10px; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>${ipCheck.code === 'ADMIN_IP_DENIED' ? 'Forbidden' : 'Admin misconfigured'}</h1>
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
    const accept = String(req.get('accept') || '').toLowerCase();
    const wantsHtml = accept.includes('text/html');

    res.set('Cache-Control', 'no-store');

    if (wantsHtml) {
      res.status(401).type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin Unauthorized</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 2rem; line-height: 1.4; }
      code { background: #f4f4f5; padding: 0.1rem 0.3rem; border-radius: 4px; }
      .box { max-width: 720px; padding: 1rem 1.25rem; border: 1px solid #e4e4e7; border-radius: 10px; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>Unauthorized</h1>
      <p>This endpoint is protected. Provide <code>Authorization: Bearer &lt;ADMIN_TOKEN&gt;</code> or open:</p>
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

  if (req.query && typeof req.query.token === 'string') {
    setAdminTokenCookie(res, provided);

    if (req.method === 'GET') {
      const u = new URL(`http://localhost${req.originalUrl}`);
      u.searchParams.delete('token');
      res.redirect(302, `${u.pathname}${u.search}`);
      return;
    }
  }

  next();
}

module.exports = adminAuth;
