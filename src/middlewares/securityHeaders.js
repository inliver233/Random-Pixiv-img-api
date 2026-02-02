const helmet = require('helmet');

const helmetMiddleware = helmet({
  // AdminJS + error pages are not CSP-hardened yet; avoid breaking UI.
  contentSecurityPolicy: false,
  // COEP/CORP/COOP can break cross-origin images; keep relaxed for this project.
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // Enable HSTS only in production (HTTPS deployments).
  hsts: process.env.NODE_ENV === 'production' ? undefined : false,
});

function securityHeaders(req, res, next) {
  return helmetMiddleware(req, res, next);
}

module.exports = securityHeaders;

