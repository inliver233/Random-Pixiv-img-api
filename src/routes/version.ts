import { Router } from 'express';

import { getBuildInfo } from '../utils/buildInfo';

const router = Router();

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

export default router;

