import axios from 'axios';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';
import { Pool } from 'pg';

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

let pgPool: Pool | null | undefined;

function getPgPool(): Pool | null {
  if (pgPool !== undefined) return pgPool;

  const url = process.env.DATABASE_URL;
  if (!url) {
    pgPool = null;
    return null;
  }

  const sslEnabled = String(process.env.DB_SSL || '').trim().toLowerCase();
  const ssl = ['1', 'true', 'yes', 'y', 'on'].includes(sslEnabled) ? { rejectUnauthorized: false } : undefined;

  pgPool = new Pool({
    connectionString: url,
    ssl,
  });

  return pgPool;
}

async function tryGetOriginalUrlFromDb(illustId: string, pageIndex: number): Promise<string | null> {
  const pool = getPgPool();
  if (!pool) return null;

  try {
    const res = await pool.query<{ original_url: string }>(
      'SELECT original_url FROM images WHERE illust_id = $1 AND page_index = $2 LIMIT 1',
      [String(illustId), Number(pageIndex)],
    );
    const row = res.rows[0];
    return row && row.original_url ? String(row.original_url) : null;
  } catch (err: unknown) {
    console.warn('DB lookup failed, falling back to Pixiv API.', err instanceof Error ? err.message : err);
    return null;
  }
}

async function hasMultiplePagesInDb(illustId: string): Promise<boolean> {
  const pool = getPgPool();
  if (!pool) return false;

  try {
    const res = await pool.query('SELECT 1 FROM images WHERE illust_id = $1 AND page_index > 0 LIMIT 1', [
      String(illustId),
    ]);
    return res.rows.length > 0;
  } catch (err: unknown) {
    console.warn('DB lookup failed (multi-page probe).', err instanceof Error ? err.message : err);
    return false;
  }
}

async function streamImageByUrl(imageURL: string, res: Response): Promise<void> {
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
}

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
    const dbOriginalUrl = await tryGetOriginalUrlFromDb(String(req.params.illustId), 0);
    if (dbOriginalUrl) {
      const hasMulti = await hasMultiplePagesInDb(String(req.params.illustId));
      if (hasMulti) {
        res.redirect(301, `/${req.params.illustId}-1.${req.params.fileExtension}`);
        return;
      }

      await streamImageByUrl(dbOriginalUrl, res);
      return;
    }

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
    await streamImageByUrl(imageURL, res);
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
    const requestedPage = Number(req.params.pageNumber);
    const dbOriginalUrl = await tryGetOriginalUrlFromDb(String(req.params.illustId), requestedPage - 1);
    if (dbOriginalUrl) {
      await streamImageByUrl(dbOriginalUrl, res);
      return;
    }

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

    if (requestedPage > pixivApiResponse.illust.page_count) {
      res.status(404).render('error', {
        error_title: '404 Not Found',
        message_en: `This work only has ${pixivApiResponse.illust.page_count} pages. Please specify a valid page number.`,
        message_zh: `這個作品只有 ${pixivApiResponse.illust.page_count} 張圖片，請指定正確的頁數。`,
      });
      return;
    }

    const imageURL = pixivApiResponse.illust.meta_pages[requestedPage - 1].image_urls.original as string;
    await streamImageByUrl(imageURL, res);
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
