const express = require('express');

// NOTE: Prisma client is generated as TypeScript under src/generated and is only usable after build.
// For the CJS dev entry (app.js), prefer delegating to the built route when available.
let delegated = false;
try {
  // eslint-disable-next-line import/no-unresolved, global-require
  const built = require('../../dist/src/routes/images');
  module.exports = built.default || built;
  delegated = true;
} catch {
  delegated = false;
}

const router = express.Router();

if (!delegated) {
  router.get('/:id', (req, res) => {
    res.status(501).json({ error: 'not_implemented', route: '/images/:id' });
  });

  module.exports = router;
}
