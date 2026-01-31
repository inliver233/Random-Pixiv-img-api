type ContentTypeModule = {
  ALLOWED_IMAGE_EXTENSIONS: string[];
  normalizeImageExtension: (value: unknown) => string | null;
  isAllowedImageExt: (ext: unknown) => boolean;
  getImageContentTypeFromExt: (ext: unknown) => string | null;
  getImageContentTypeFromFilename: (filename: unknown) => string | null;
};

// Use the JS implementation so app.js (CJS) and app.ts (TS build) share behavior.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('./contentType.js') as ContentTypeModule;

export const ALLOWED_IMAGE_EXTENSIONS = mod.ALLOWED_IMAGE_EXTENSIONS;
export const normalizeImageExtension = mod.normalizeImageExtension;
export const isAllowedImageExt = mod.isAllowedImageExt;
export const getImageContentTypeFromExt = mod.getImageContentTypeFromExt;
export const getImageContentTypeFromFilename = mod.getImageContentTypeFromFilename;

