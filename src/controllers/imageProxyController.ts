import axios from 'axios';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';

import pixivService from '../services/pixivService';
import { getImageContentTypeFromFilename } from '../utils/contentType';

const imageHeaders = {
  Referer: 'https://www.pixiv.net/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
};

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'max-age=31536000, public',
};

type RenderErrorViewModel = {
  error_title: string;
  message_en: string;
  message_zh: string;
};

const pixivApiResponseValidator = (pixivApiResponse: any): RenderErrorViewModel | null => {
  // General error handling for Pixiv API response
  if ('error' in pixivApiResponse) {
    if (pixivApiResponse.error.user_message === 'ページが見つかりませんでした') {
      return {
        error_title: '404 Not Found',
        message_en: 'This work has been deleted or restricted.',
        message_zh: '這個作品可能已被刪除，或無法取得。',
      };
    }
    return {
      error_title: '404 Not Found',
      message_en: pixivApiResponse.error.user_message,
      message_zh: '',
    };
  }
  if (
    pixivApiResponse.illust.image_urls.square_medium === 'https://s.pximg.net/common/images/limit_unknown_360.png'
  ) {
    return {
      error_title: '404 Not Found',
      message_en: 'This work has been deleted or restricted.',
      message_zh: '這個作品可能已被刪除，或無法取得。',
    };
  }
  return null;
};

const getIllustSingle = async (req: Request, res: Response) => {
  try {
    const pixivApiResponse = (await pixivService.getPixivIllustIdData(String(req.params.illustId))) as any;
    const pixivApiResponseValidationResult = pixivApiResponseValidator(pixivApiResponse);
    if (pixivApiResponseValidationResult !== null) {
      res.status(404).render('error', pixivApiResponseValidationResult);
      return;
    }
    if (pixivApiResponse.illust.page_count > 1) {
      // Multi image work, redirect to the first page
      res.redirect(301, `/${req.params.illustId}-1.${req.params.fileExtension}`);
      return;
    }
    const imageURL = pixivApiResponse.illust.meta_single_page.original_image_url as string;
    const imageResponse = await axios.get<Readable>(imageURL, {
      headers: imageHeaders,
      responseType: 'stream',
    });
    const imageFilename = imageURL.substring(imageURL.lastIndexOf('/') + 1);
    res.writeHead(200, {
      'Content-Type': getImageContentTypeFromFilename(imageFilename) || 'application/octet-stream',
      'Content-Disposition': `filename="${imageFilename}"`,
      'X-Origin-URL': imageURL,
      'X-Crawl-Date': new Date().toUTCString(),
      ...responseHeaders,
    });

    const sourceStream = imageResponse.data;

    // Handle source stream errors
    sourceStream.on('error', (err) => {
      console.error('Source stream error:', err);
      sourceStream.destroy();
      // Can't send error page after headers are sent, just end the response
      if (!res.headersSent) {
        res.status(500).render('error', {
          error_title: '500 Internal Server Error',
          message_en: 'Internal Server Error',
          message_zh: '伺服器內部錯誤',
        });
      } else {
        res.end();
      }
    });

    // Handle client disconnect - destroy source stream to prevent memory leak
    res.on('close', () => {
      if (!sourceStream.destroyed) {
        console.log('Client closed connection, destroying stream');
        sourceStream.destroy();
      }
    });

    // Pipe the stream
    sourceStream.pipe(res);
  } catch (error: any) {
    console.error('Illust proxy controller error:', error);
    if (error?.message === 'Pixiv API rate limit exceeded.') {
      res
        .status(503)
        .header('Retry-After', '60')
        .render('error', {
          error_title: '503 Service Unavailable',
          message_en: 'API rate limit exceeded. Please try again later.',
          message_zh: 'API 請求次數超過限制，請稍後再試。',
        });
      return;
    }
    res.status(500).render('error', {
      error_title: '500 Internal Server Error',
      message_en: 'Internal Server Error',
      message_zh: '伺服器內部錯誤',
    });
  }
};

const getIllustMulti = async (req: Request, res: Response) => {
  try {
    const pixivApiResponse = (await pixivService.getPixivIllustIdData(String(req.params.illustId))) as any;
    const pixivApiResponseValidationResult = pixivApiResponseValidator(pixivApiResponse);
    if (pixivApiResponseValidationResult !== null) {
      res.status(404).render('error', pixivApiResponseValidationResult);
      return;
    }
    if (pixivApiResponse.illust.page_count === 1) {
      res.status(404).render('error', {
        error_title: '404 Not Found',
        message_en: 'This work has only one page. Please remove the page number from the URL.',
        message_zh: '這個作品ID中有只有一張圖片，不需要指定是第幾張圖片。',
      });
      return;
    }

    const requestedPage = Number(req.params.pageNumber);
    if (requestedPage > pixivApiResponse.illust.page_count) {
      res.status(404).render('error', {
        error_title: '404 Not Found',
        message_en: `This work only has ${pixivApiResponse.illust.page_count} pages. Please specify a valid page number.`,
        message_zh: `這個作品只有 ${pixivApiResponse.illust.page_count} 張圖片，請指定正確的頁數。`,
      });
      return;
    }

    const imageURL = pixivApiResponse.illust.meta_pages[requestedPage - 1].image_urls.original as string;
    const imageResponse = await axios.get<Readable>(imageURL, {
      headers: imageHeaders,
      responseType: 'stream',
    });
    const imageFilename = imageURL.substring(imageURL.lastIndexOf('/') + 1);
    res.writeHead(200, {
      'Content-Type': getImageContentTypeFromFilename(imageFilename) || 'application/octet-stream',
      'Content-Disposition': `filename="${imageFilename}"`,
      'X-Origin-URL': imageURL,
      'X-Crawl-Date': new Date().toUTCString(),
      ...responseHeaders,
    });

    const sourceStream = imageResponse.data;

    // Handle source stream errors
    sourceStream.on('error', (err) => {
      console.error('Source stream error:', err);
      sourceStream.destroy();
      // Can't send error page after headers are sent, just end the response
      if (!res.headersSent) {
        res.status(500).render('error', {
          error_title: '500 Internal Server Error',
          message_en: 'Internal Server Error',
          message_zh: '伺服器內部錯誤',
        });
      } else {
        res.end();
      }
    });

    // Handle client disconnect - destroy source stream to prevent memory leak
    res.on('close', () => {
      if (!sourceStream.destroyed) {
        console.log('Client closed connection, destroying stream');
        sourceStream.destroy();
      }
    });

    // Pipe the stream
    sourceStream.pipe(res);
  } catch (error: any) {
    console.error('Illust proxy controller error:', error);
    if (error?.message === 'Pixiv API rate limit exceeded.') {
      res
        .status(503)
        .header('Retry-After', '60')
        .render('error', {
          error_title: '503 Service Unavailable',
          message_en: 'API rate limit exceeded. Please try again later.',
          message_zh: 'API 請求次數超過限制，請稍後再試。',
        });
    } else {
      res.status(500).render('error', {
        error_title: '500 Internal Server Error',
        message_en: 'Internal Server Error',
        message_zh: '伺服器內部錯誤',
      });
    }
  }
};

const imageProxyController = {
  getIllustSingle,
  getIllustMulti,
};

export default imageProxyController;
