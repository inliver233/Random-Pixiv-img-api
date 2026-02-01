const express = require('express');

const adminAuth = require('../middlewares/adminAuth');

const router = express.Router();

router.use(adminAuth);

router.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
});

module.exports = router;

