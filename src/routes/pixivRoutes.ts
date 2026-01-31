import { Router } from 'express';

import imageProxyController from '../controllers/imageProxyController';
import { validateExtension, validateIllustId, validatePageNumber } from '../middlewares/validationMiddleware';

const router = Router();

// Multi image route
router.get(
  '/:illustId-:pageNumber.:fileExtension',
  validateIllustId,
  validatePageNumber,
  validateExtension,
  imageProxyController.getIllustMulti,
);

// Single image route
router.get(
  '/:illustId.:fileExtension',
  validateIllustId,
  validateExtension,
  imageProxyController.getIllustSingle,
);

export default router;

