const express = require('express');
const imageProxyController = require('../controllers/imageProxyController');
const { validateIllustId, validatePageNumber, validateExtension } = require('../middlewares/validationMiddleware');

const router = express.Router();

function redirectLegacyZeroPage(req, res, next) {
  const pageNumber = String(req && req.params && req.params.pageNumber ? req.params.pageNumber : '').trim();
  if (pageNumber !== '0') {
    next();
    return;
  }

  const illustId = String(req && req.params && req.params.illustId ? req.params.illustId : '').trim();
  const ext = String(req && req.params && req.params.fileExtension ? req.params.fileExtension : '').trim();
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(301, `/${encodeURIComponent(illustId)}-1.${encodeURIComponent(ext)}`);
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
router.get('/:illustId.:fileExtension', validateIllustId, validateExtension, imageProxyController.getIllustSingle);

module.exports = router;
