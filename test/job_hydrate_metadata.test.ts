import { afterEach, describe, expect, it, vi } from 'vitest';

import pixivService from '../src/services/pixivService';
import { hydrateMetadata } from '../src/jobs/hydrateMetadata';

const ILLUST_ID = 12345678n;

function originalUrl(illustId: bigint, pageIndex: number, ext = 'jpg') {
  return `https://i.pximg.net/img-original/img/2020/01/01/00/00/00/${illustId.toString()}_p${pageIndex}.${ext}`;
}

describe('hydrate_metadata (job skeleton)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enumerates single page original_url', async () => {
    const url = originalUrl(ILLUST_ID, 0);

    const spy = vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 1,
        x_restrict: 1,
        image_urls: { square_medium: 'https://example.invalid/square.jpg' },
        meta_single_page: { original_image_url: url },
        meta_pages: [],
      },
    } as any);

    const pages = await hydrateMetadata(ILLUST_ID);

    expect(spy).toHaveBeenCalledWith(ILLUST_ID.toString(), true);
    expect(pages).toMatchObject([
      {
        illustId: ILLUST_ID,
        pageIndex: 0,
        ext: 'jpg',
        originalUrl: url,
        xRestrict: 1,
      },
    ]);
  });

  it('enumerates multi page original_url list and sorts by pageIndex', async () => {
    const urls = [originalUrl(ILLUST_ID, 0), originalUrl(ILLUST_ID, 1), originalUrl(ILLUST_ID, 2)];

    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 3,
        image_urls: { square_medium: 'https://example.invalid/square.jpg' },
        meta_single_page: {},
        meta_pages: urls.map((u) => ({ image_urls: { original: u } })),
      },
    } as any);

    const pages = await hydrateMetadata(ILLUST_ID);
    expect(pages.map((p) => p.pageIndex)).toEqual([0, 1, 2]);
    expect(pages.map((p) => p.originalUrl)).toEqual(urls);
  });

  it('throws on Pixiv error payload', async () => {
    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      error: { user_message: 'not found' },
    } as any);

    await expect(hydrateMetadata(ILLUST_ID)).rejects.toThrow(/Pixiv API returned error/i);
  });

  it('throws when meta_pages length mismatches page_count', async () => {
    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 2,
        image_urls: { square_medium: 'https://example.invalid/square.jpg' },
        meta_single_page: {},
        meta_pages: [{ image_urls: { original: originalUrl(ILLUST_ID, 0) } }],
      },
    } as any);

    await expect(hydrateMetadata(ILLUST_ID)).rejects.toThrow(/meta_pages length mismatch/i);
  });
});
