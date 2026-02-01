const express = require('express');

let delegated = false;
try {
  // eslint-disable-next-line import/no-unresolved, global-require
  const built = require('../../dist/src/routes/admin');
  module.exports = built.default || built;
  delegated = true;
} catch {
  delegated = false;
}

const router = express.Router();

if (!delegated) {
  const adminAuth = require('../middlewares/adminAuth');

  router.use(adminAuth);

  router.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true });
  });

  module.exports = router;
}
