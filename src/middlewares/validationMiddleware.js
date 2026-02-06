function failLegacyValidation(req, next, message) {
  req.__force_json_error = true;
  const err = new Error(message);
  err.status = 400;
  err.code = 'BAD_REQUEST';
  next(err);
}

function validateIllustId(req, _res, next) {
  const { illustId } = req.params;
  // Check if the illustId contains only digits
  if (/^([1-9][0-9]*)$/.test(illustId)) {
    next();
  } else {
    failLegacyValidation(req, next, 'Invalid ID format.');
  }
}

function validatePageNumber(req, _res, next) {
  const { pageNumber } = req.params;
  // Check if the pageNumber contains only digits and is greater than 0
  if (/^\d+$/.test(pageNumber) && pageNumber > 0) {
    next();
  } else {
    failLegacyValidation(req, next, 'Invalid page number.');
  }
}

function validateExtension(req, _res, next) {
  const { ALLOWED_IMAGE_EXTENSIONS } = require('../utils/contentType');
  const fileExtension = req.params.fileExtension.toLowerCase();

  // Check if the file extension is valid
  if (ALLOWED_IMAGE_EXTENSIONS.includes(fileExtension)) {
    next();
  } else {
    failLegacyValidation(req, next, 'Invalid file extension.');
  }
}

module.exports = {
  validateIllustId,
  validatePageNumber,
  validateExtension,
};
