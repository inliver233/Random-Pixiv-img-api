const express = require('express');

const router = express.Router();

router.get('/:id.:ext', (req, res) => {
  res.status(501).json({ error: 'not_implemented', route: '/i/:id.:ext' });
});

module.exports = router;

