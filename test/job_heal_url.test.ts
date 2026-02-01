import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import pixivService from '../src/services/pixivService';
import { setPrismaClientForTest } from '../src/db/prismaClient';
import { healUrl } from '../src/jobs/healUrl';
import { IMAGE_STATUS_ACTIVE, IMAGE_STATUS_DISABLED } from '../src/repositories/imagesRepo';

const ILLUST_ID = 12345678n;

function originalUrl(illustId: bigint, pageIndex: number, ext = 'jpg') {
  return `https://i.pximg.net/img-original/img/2020/01/01/00/00/00/${illustId.toString()}_p${pageIndex}.${ext}`;
}

describe('heal_url', () => {
  const prisma = {
    $transaction: vi.fn(),
    image: {
      updateMany: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    setPrismaClientForTest(prisma);
    prisma.image.updateMany.mockReset();
    prisma.$transaction.mockReset();

    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    vi.restoreAllMocks();
  });

  it('updates original_url and restores status for multi-page illust', async () => {
    const urls = [originalUrl(ILLUST_ID, 2), originalUrl(ILLUST_ID, 0), originalUrl(ILLUST_ID, 1)];

    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 3,
        meta_single_page: {},
        meta_pages: urls.map((u) => ({ image_urls: { original: u } })),
      },
    } as any);

    prisma.image.updateMany.mockResolvedValue({ count: 1 });

    const result = await healUrl(ILLUST_ID);

    expect(result).toEqual({ updated: 3, pages: 3 });
    expect(prisma.image.updateMany).toHaveBeenCalledTimes(3);

    expect(prisma.image.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        illustId: ILLUST_ID,
        pageIndex: 0,
        status: { not: IMAGE_STATUS_DISABLED },
      },
      data: {
        originalUrl: originalUrl(ILLUST_ID, 0),
        ext: 'jpg',
        status: IMAGE_STATUS_ACTIVE,
      },
    });

    expect(prisma.image.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        illustId: ILLUST_ID,
        pageIndex: 1,
        status: { not: IMAGE_STATUS_DISABLED },
      },
      data: {
        originalUrl: originalUrl(ILLUST_ID, 1),
        ext: 'jpg',
        status: IMAGE_STATUS_ACTIVE,
      },
    });

    expect(prisma.image.updateMany).toHaveBeenNthCalledWith(3, {
      where: {
        illustId: ILLUST_ID,
        pageIndex: 2,
        status: { not: IMAGE_STATUS_DISABLED },
      },
      data: {
        originalUrl: originalUrl(ILLUST_ID, 2),
        ext: 'jpg',
        status: IMAGE_STATUS_ACTIVE,
      },
    });
  });

  it('updates original_url for single-page illust', async () => {
    const url = originalUrl(ILLUST_ID, 0);

    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 1,
        meta_single_page: { original_image_url: url },
        meta_pages: [],
      },
    } as any);

    prisma.image.updateMany.mockResolvedValue({ count: 1 });

    const result = await healUrl(ILLUST_ID);

    expect(result).toEqual({ updated: 1, pages: 1 });
    expect(prisma.image.updateMany).toHaveBeenCalledTimes(1);
  });

  it('throws on Pixiv error payload', async () => {
    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      error: { user_message: 'not found' },
    } as any);

    await expect(healUrl(ILLUST_ID)).rejects.toThrow(/Pixiv API returned error/i);
    expect(prisma.image.updateMany).not.toHaveBeenCalled();
  });
});

