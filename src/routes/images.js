const express = require('express');

const router = express.Router();

router.get('/:id', (req, res) => {
  res.status(501).json({ error: 'not_implemented', route: '/images/:id' });
});

module.exports = router;

