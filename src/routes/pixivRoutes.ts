import { Router } from 'express';

import imageProxyController from '../controllers/imageProxyController';
import { validateExtension, validateIllustId, validatePageNumber } from '../middlewares/validationMiddleware';

const router = Router();

function redirectLegacyZeroPage(req: any, res: any, next: any) {
  const pageNumber = String(req?.params?.pageNumber ?? '').trim();
  if (pageNumber !== '0') {
    next();
    return;
  }

  const illustId = String(req?.params?.illustId ?? '').trim();
  const ext = String(req?.params?.fileExtension ?? '').trim();
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(301, `/${encodeURIComponent(illustId)}-1.${encodeURIComponent(ext)}`);
  return;
}

// Multi image route
router.get(
  '/:illustId-:pageNumber.:fileExtension',
  validateIllustId,
  validateExtension,
  redirectLegacyZeroPage,
  validatePageNumber,
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
