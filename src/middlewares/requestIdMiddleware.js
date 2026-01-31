const crypto = require('crypto');

function requestIdMiddleware(req, res, next) {
  const incoming = req.get('x-request-id');
  const requestId = incoming && incoming.trim() ? incoming.trim() : crypto.randomUUID();

  req.request_id = requestId;
  res.locals.request_id = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
}

module.exports = requestIdMiddleware;

