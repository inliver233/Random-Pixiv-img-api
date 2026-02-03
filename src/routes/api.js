const express = require('express');

// NOTE: Prisma client is generated as TypeScript under src/generated and is only usable after build.
// For the CJS dev entry (app.js), prefer delegating to the built routes when available.
let delegated = false;
try {
  // eslint-disable-next-line import/no-unresolved, global-require
  const built = require('../../dist/src/routes/api');
  module.exports = built.default || built;
  delegated = true;
} catch {
  delegated = false;
}

const router = express.Router();

if (!delegated) {
  router.use('/random', require('./random'));
  router.use('/images', require('./images'));
  router.use('/i', require('./imageById'));
  router.use('/healthz', require('./healthz'));
  router.use('/metrics', require('./metrics'));
  router.use('/admin', require('./admin'));

  module.exports = router;
}
