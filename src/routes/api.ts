import { Router } from 'express';

import randomRoute from './random';
import imagesRoute from './images';
import imageByIdRoute from './imageById';
import tagsRoute from './tags';
import authorsRoute from './authors';
import healthzRoute from './healthz';
import versionRoute from './version';
import metricsRoute from './metrics';
import adminRoute from './admin';

const router = Router();

router.use('/random', randomRoute);
router.use('/tags', tagsRoute);
router.use('/authors', authorsRoute);
router.use('/images', imagesRoute);
router.use('/i', imageByIdRoute);
router.use('/healthz', healthzRoute);
router.use('/version', versionRoute);
router.use('/metrics', metricsRoute);
router.use('/admin', adminRoute);

export default router;
