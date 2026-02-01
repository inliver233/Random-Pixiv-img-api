function getRequestId(req, res) {
  return req.request_id || (res.locals && res.locals.request_id);
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
