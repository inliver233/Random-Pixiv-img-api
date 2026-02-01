function getRequestId(req, res) {
  return req.request_id || (res.locals && res.locals.request_id);
}

function extractToken(req) {
  const auth = (req.get('authorization') || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    return token || null;
  }

  const headerToken = req.get('x-admin-token');
  if (headerToken && headerToken.trim()) return headerToken.trim();

  return null;
}

function adminAuth(req, res, next) {
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

module.exports = adminAuth;

