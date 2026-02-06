import type { NextFunction, Request, Response } from 'express';

import { ALLOWED_IMAGE_EXTENSIONS } from '../utils/contentType';

function failLegacyValidation(req: Request, next: NextFunction, message: string): void {
  (req as any).__force_json_error = true;
  const err = new Error(message) as Error & { status?: number; code?: string };
  err.status = 400;
  err.code = 'BAD_REQUEST';
  next(err);
}

export function validateIllustId(req: Request, _res: Response, next: NextFunction) {
  const illustId = String((req.params as any).illustId);
  // Check if the illustId contains only digits
  if (/^([1-9][0-9]*)$/.test(illustId)) {
    next();
  } else {
    failLegacyValidation(req, next, 'Invalid ID format.');
  }
}

export function validatePageNumber(req: Request, _res: Response, next: NextFunction) {
  const pageNumber = String((req.params as any).pageNumber);
  // Check if the pageNumber contains only digits and is greater than 0
  if (/^\d+$/.test(pageNumber) && Number(pageNumber) > 0) {
    next();
  } else {
    failLegacyValidation(req, next, 'Invalid page number.');
  }
}

export function validateExtension(req: Request, _res: Response, next: NextFunction) {
  const fileExtension = String((req.params as any).fileExtension).toLowerCase();

  // Check if the file extension is valid
  if (ALLOWED_IMAGE_EXTENSIONS.includes(fileExtension)) {
    next();
  } else {
    failLegacyValidation(req, next, 'Invalid file extension.');
  }
}
