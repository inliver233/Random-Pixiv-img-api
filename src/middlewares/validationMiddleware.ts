import type { NextFunction, Request, Response } from 'express';

export function validateIllustId(req: Request, res: Response, next: NextFunction) {
  const illustId = String((req.params as any).illustId);
  // Check if the illustId contains only digits
  if (/^([1-9][0-9]*)$/.test(illustId)) {
    next();
  } else {
    res.status(400).render('error', {
      error_title: '400 Bad Request',
      message_en: 'Invalid ID format.',
      message_zh: '無效的ID格式。',
    });
  }
}

export function validatePageNumber(req: Request, res: Response, next: NextFunction) {
  const pageNumber = String((req.params as any).pageNumber);
  // Check if the pageNumber contains only digits and is greater than 0
  if (/^\d+$/.test(pageNumber) && Number(pageNumber) > 0) {
    next();
  } else {
    res.status(400).render('error', {
      error_title: '400 Bad Request',
      message_en: 'Invalid page number.',
      message_zh: '無效的頁數。',
    });
  }
}

export function validateExtension(req: Request, res: Response, next: NextFunction) {
  const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif'];
  const fileExtension = String((req.params as any).fileExtension).toLowerCase();

  // Check if the file extension is valid
  if (allowedExtensions.includes(fileExtension)) {
    next();
  } else {
    res.status(400).render('error', {
      error_title: '400 Bad Request',
      message_en: 'Invalid file extension.',
      message_zh: '無效的檔案副檔名。',
    });
  }
}

