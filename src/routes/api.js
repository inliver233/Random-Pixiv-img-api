const express = require('express');

const router = express.Router();

router.use('/random', require('./random'));
router.use('/images', require('./images'));
router.use('/i', require('./imageById'));
router.use('/healthz', require('./healthz'));
router.use('/metrics', require('./metrics'));
router.use('/admin', require('./admin'));

module.exports = router;
