const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.status(501).json({ error: 'not_implemented', route: '/metrics' });
});

module.exports = router;

