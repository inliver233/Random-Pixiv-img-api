import type { AxiosResponse } from 'axios';
import type { Readable } from 'node:stream';

import { pixivImageGet } from './axiosClient';

export const PIXIV_IMAGE_HEADERS = {
  Referer: 'https://www.pixiv.net/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
};

export async function fetchPixivImageStream(url: string, signal: AbortSignal): Promise<AxiosResponse<Readable>> {
  return pixivImageGet<Readable>(url, {
    headers: PIXIV_IMAGE_HEADERS,
    responseType: 'stream',
    signal,
  });
}
