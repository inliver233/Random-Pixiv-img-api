const express = require('express');
const { getBuildInfo } = require('../utils/buildInfo');

const router = express.Router();

router.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const build = getBuildInfo();
  res.status(200).json({
    ok: true,
    version: build.version,
    commit: build.commit,
    build_time: build.build_time,
  });
});

module.exports = router;
