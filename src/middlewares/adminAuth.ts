import type { NextFunction, Request, Response } from 'express';

function getRequestId(req: Request, res: Response): string | undefined {
  return (req as any).request_id || res.locals.request_id;
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

function setAdminTokenCookie(res: Response, token: string) {
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

  // Only mark Secure in production. (Local dev often runs without HTTPS.)
  if (process.env.NODE_ENV === 'production') {
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
  const expected = String(process.env.ADMIN_TOKEN || '').trim();
  const provided = extractToken(req);

  if (!expected || !provided || provided !== expected) {
    const accept = (req.header('accept') || '').toLowerCase();
    const wantsHtml = accept.includes('text/html');

    res.setHeader('Cache-Control', 'no-store');

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

  if (typeof req.query?.token === 'string') {
    // First-time browser access: persist token as cookie to allow subsequent asset/API requests.
    setAdminTokenCookie(res, provided);

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
