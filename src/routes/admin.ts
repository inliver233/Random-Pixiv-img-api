import { Router } from 'express';
import session from 'express-session';

import adminAuth from '../middlewares/adminAuth';
import adminCsrf from '../middlewares/adminCsrf';
import adminWriteRateLimit from '../middlewares/adminWriteRateLimit';
import adminImportRouter from './adminImport';
import adminImagesActionsRouter from './adminImagesActions';

const router = Router();

function parseBooleanEnv(value: unknown, defaultValue: boolean): boolean {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

const sessionSecret = String(process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_TOKEN || 'pixivcat_admin_session').trim();
router.use(session({
  name: 'pixivcat_admin_sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    path: '/admin',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

router.use(adminAuth);
router.use(adminWriteRateLimit);
router.use(adminCsrf);

router.get('/login', (req, res) => {
  if (!parseBooleanEnv(process.env.ADMIN_SESSION_AUTH_ENABLED, false)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'admin_session_auth_disabled' });
    return;
  }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin Login</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 2rem; line-height: 1.4; }
      .box { max-width: 420px; padding: 1rem 1.25rem; border: 1px solid #e4e4e7; border-radius: 10px; }
      label { display: block; margin-top: 0.75rem; font-weight: 600; }
      input { width: 100%; padding: 0.5rem; margin-top: 0.25rem; border: 1px solid #e4e4e7; border-radius: 8px; }
      button { margin-top: 1rem; padding: 0.5rem 0.75rem; border: 1px solid #111827; background: #111827; color: #fff; border-radius: 8px; cursor: pointer; }
      .hint { color: #666; font-size: 0.9rem; margin-top: 0.75rem; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1 style="margin-top:0">Admin Login</h1>
      <form method="post" action="/admin/login">
        <label>Username
          <input name="username" autocomplete="username" />
        </label>
        <label>Password
          <input name="password" type="password" autocomplete="current-password" />
        </label>
        <button type="submit">Sign in</button>
      </form>
      <p class="hint">This form requires ADMIN_SESSION_* env to be configured.</p>
    </div>
  </body>
</html>`);
});

router.post('/login', (req, res) => {
  if (!parseBooleanEnv(process.env.ADMIN_SESSION_AUTH_ENABLED, false)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'admin_session_auth_disabled' });
    return;
  }

    const expectedUser = String(process.env.ADMIN_SESSION_USER || '').trim();
    const expectedPass = String(process.env.ADMIN_SESSION_PASS || '').trim();
    const secret = String(process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_TOKEN || '').trim();

    res.setHeader('Cache-Control', 'no-store');

    if (!secret) {
      res.status(503).json({ code: 'ADMIN_SESSION_MISCONFIGURED', message: 'Missing ADMIN_SESSION_SECRET.' });
      return;
    }

    if (!expectedUser || !expectedPass) {
      res.status(503).json({ code: 'ADMIN_SESSION_MISCONFIGURED', message: 'Missing ADMIN_SESSION_USER/ADMIN_SESSION_PASS.' });
      return;
    }

    const username = String((req as any).body?.username ?? '').trim();
    const password = String((req as any).body?.password ?? '').trim();

    if (!username || !password || username !== expectedUser || password !== expectedPass) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid credentials.' });
      return;
    }

    const sessionObj = (req as any).session;
    if (!sessionObj) {
      res.status(503).json({ code: 'ADMIN_SESSION_MISCONFIGURED', message: 'Session middleware not available.' });
      return;
    }

    sessionObj.admin = true;
    sessionObj.admin_user = username;

    res.redirect(302, '/admin');
});

router.post('/logout', (req, res) => {
  if (!parseBooleanEnv(process.env.ADMIN_SESSION_AUTH_ENABLED, false)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'admin_session_auth_disabled' });
    return;
  }

    res.setHeader('Cache-Control', 'no-store');
    const sessionObj = (req as any).session;
    if (!sessionObj || typeof sessionObj.destroy !== 'function') {
      res.redirect(302, '/admin/login');
      return;
    }

    sessionObj.destroy(() => {
      res.redirect(302, '/admin/login');
    });
});

router.use(adminImportRouter);
router.use(adminImagesActionsRouter);

if (process.env.NODE_ENV === 'test') {
  router.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true });
  });
} else {
  router.use((req, res, next) => {
    (async () => {
      // Lazy-load AdminJS in non-test environments to keep unit tests fast.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getAdminJsRouter } = require('../admin/adminJs') as typeof import('../admin/adminJs');
      const adminRouter = await getAdminJsRouter();
      adminRouter(req, res, next);
    })().catch(() => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).json({ error: 'admin_not_ready' });
    });
  });
}

export default router;
