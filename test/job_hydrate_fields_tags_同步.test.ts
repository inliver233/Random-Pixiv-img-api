import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import { hydrateMetadata, persistHydratedMetadata } from '../src/jobs/hydrateMetadata';
import pixivService from '../src/services/pixivService';
import * as tagsRepo from '../src/repositories/tagsRepo';

const ILLUST_ID = 12345678n;

function originalUrl(illustId: bigint, pageIndex: number, ext = 'jpg') {
  return `https://i.pximg.net/img-original/img/2020/01/01/00/00/00/${illustId.toString()}_p${pageIndex}.${ext}`;
}

describe('hydrate_metadata fields: tags sync', () => {
  const prisma = {
    image: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  } as any;

  beforeEach(() => {
    setPrismaClientForTest(prisma);
    prisma.image.findMany.mockReset();
    prisma.image.updateMany.mockReset();
    prisma.$transaction.mockReset();
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    vi.restoreAllMocks();
  });

  it('dedupes tags (case-insensitive) and syncs image_tags per page', async () => {
    const urls = [originalUrl(ILLUST_ID, 0), originalUrl(ILLUST_ID, 1)];

    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 2,
        tags: [
          { name: 'Foo', translated_name: 'バー' },
          { name: 'foo' },
          { name: ' Bar ' },
        ],
        image_urls: { square_medium: 'https://example.invalid/square.jpg' },
        meta_single_page: {},
        meta_pages: urls.map((u) => ({ image_urls: { original: u } })),
      },
    } as any);

    const pages = await hydrateMetadata(ILLUST_ID);
    expect(pages).toHaveLength(2);
    expect(pages[0].tags).toEqual([
      { name: 'Foo', translatedName: 'バー' },
      { name: 'Bar', translatedName: null },
    ]);

    prisma.image.findMany.mockResolvedValueOnce([
      { id: 100n, pageIndex: 0 },
      { id: 101n, pageIndex: 1 },
    ]);

    const syncSpy = vi.spyOn(tagsRepo, 'syncImageTags').mockResolvedValue({ added: 2, removed: 0 } as any);

    const updated = await persistHydratedMetadata(ILLUST_ID, pages);
    expect(updated).toBe(0);

    expect(prisma.image.findMany).toHaveBeenCalledWith({
      where: { illustId: ILLUST_ID, pageIndex: { in: [0, 1] } },
      select: { id: true, pageIndex: true },
    });

    expect(syncSpy).toHaveBeenCalledTimes(2);
    expect(syncSpy).toHaveBeenNthCalledWith(1, 100n, [
      { name: 'Foo', translatedName: 'バー' },
      { name: 'Bar', translatedName: null },
    ]);
    expect(syncSpy).toHaveBeenNthCalledWith(2, 101n, [
      { name: 'Foo', translatedName: 'バー' },
      { name: 'Bar', translatedName: null },
    ]);
  });

  it('skips sync when Pixiv tags list is empty or missing', async () => {
    const url = originalUrl(ILLUST_ID, 0);

    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 1,
        image_urls: { square_medium: 'https://example.invalid/square.jpg' },
        meta_single_page: { original_image_url: url },
        meta_pages: [],
      },
    } as any);

    const pages = await hydrateMetadata(ILLUST_ID);
    expect(pages[0].tags).toEqual([]);

    const syncSpy = vi.spyOn(tagsRepo, 'syncImageTags').mockResolvedValue({ added: 0, removed: 0 } as any);
    const updated = await persistHydratedMetadata(ILLUST_ID, pages);

    expect(updated).toBe(0);
    expect(prisma.image.findMany).not.toHaveBeenCalled();
    expect(syncSpy).not.toHaveBeenCalled();
  });
});

