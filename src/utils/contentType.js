const path = require('path');

const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

function normalizeImageExtension(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  return raw.startsWith('.') ? raw.slice(1) : raw;
}

function isAllowedImageExt(ext) {
  const normalized = normalizeImageExtension(ext);
  if (!normalized) return false;
  return ALLOWED_IMAGE_EXTENSIONS.includes(normalized);
}

function getImageContentTypeFromExt(ext) {
  const normalized = normalizeImageExtension(ext);
  switch (normalized) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return null;
  }
}

function getImageContentTypeFromFilename(filename) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  return getImageContentTypeFromExt(extension);
}

module.exports = {
  ALLOWED_IMAGE_EXTENSIONS,
  normalizeImageExtension,
  isAllowedImageExt,
  getImageContentTypeFromExt,
  getImageContentTypeFromFilename,
};

