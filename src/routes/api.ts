import { Router } from 'express';

import randomRoute from './random';
import imagesRoute from './images';
import imageByIdRoute from './imageById';
import healthzRoute from './healthz';
import metricsRoute from './metrics';
import adminRoute from './admin';

const router = Router();

router.use('/random', randomRoute);
router.use('/images', imagesRoute);
router.use('/i', imageByIdRoute);
router.use('/healthz', healthzRoute);
router.use('/metrics', metricsRoute);
router.use('/admin', adminRoute);

export default router;
