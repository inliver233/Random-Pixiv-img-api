import type { NextFunction, Request, Response } from 'express';

function getRequestId(req: Request, res: Response): string | undefined {
  return (req as any).request_id || res.locals.request_id;
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

  return null;
}

export default function adminAuth(req: Request, res: Response, next: NextFunction) {
  const expected = String(process.env.ADMIN_TOKEN || '').trim();
  const provided = extractToken(req);

  if (!expected || !provided || provided !== expected) {
    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
      request_id: getRequestId(req, res),
    });
    return;
  }

  next();
}

