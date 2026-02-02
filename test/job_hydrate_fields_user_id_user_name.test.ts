import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import { hydrateMetadata, persistHydratedMetadata } from '../src/jobs/hydrateMetadata';
import pixivService from '../src/services/pixivService';

const ILLUST_ID = 12345678n;

function originalUrl(illustId: bigint, pageIndex: number, ext = 'jpg') {
  return `https://i.pximg.net/img-original/img/2020/01/01/00/00/00/${illustId.toString()}_p${pageIndex}.${ext}`;
}

describe('hydrate_metadata fields: user_id/user_name', () => {
  const prisma = {
    image: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  } as any;

  beforeEach(() => {
    setPrismaClientForTest(prisma);
    prisma.image.updateMany.mockReset();
    prisma.$transaction.mockReset();
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    vi.restoreAllMocks();
  });

  it('maps user_id/user_name and persists to DB', async () => {
    const url = originalUrl(ILLUST_ID, 0);

    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 1,
        user: { id: 987654, name: 'unit-test-user' },
        image_urls: { square_medium: 'https://example.invalid/square.jpg' },
        meta_single_page: { original_image_url: url },
        meta_pages: [],
      },
    } as any);

    const pages = await hydrateMetadata(ILLUST_ID);
    expect(pages[0]).toMatchObject({ userId: 987654n, userName: 'unit-test-user' });

    prisma.image.updateMany.mockResolvedValueOnce({ count: 1 });
    const updated = await persistHydratedMetadata(ILLUST_ID, pages);
    expect(updated).toBe(1);

    expect(prisma.image.updateMany).toHaveBeenCalledWith({
      where: { illustId: ILLUST_ID, pageIndex: 0 },
      data: { originalUrl: url, ext: 'jpg', userId: 987654n, userName: 'unit-test-user' },
    });
  });

  it('persists userId even if userName is empty', async () => {
    const url = originalUrl(ILLUST_ID, 0);

    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 1,
        user: { id: 12, name: '   ' },
        image_urls: { square_medium: 'https://example.invalid/square.jpg' },
        meta_single_page: { original_image_url: url },
        meta_pages: [],
      },
    } as any);

    const pages = await hydrateMetadata(ILLUST_ID);
    expect(pages[0]).toMatchObject({ userId: 12n, userName: null });

    prisma.image.updateMany.mockResolvedValueOnce({ count: 1 });
    const updated = await persistHydratedMetadata(ILLUST_ID, pages);
    expect(updated).toBe(1);

    expect(prisma.image.updateMany).toHaveBeenCalledWith({
      where: { illustId: ILLUST_ID, pageIndex: 0 },
      data: { originalUrl: url, ext: 'jpg', userId: 12n },
    });
  });

  it('skips user fields when user payload is missing', async () => {
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
    expect(pages[0]).toMatchObject({ userId: null, userName: null });

    prisma.image.updateMany.mockResolvedValueOnce({ count: 1 });

    const updated = await persistHydratedMetadata(ILLUST_ID, pages);
    expect(updated).toBe(1);
    expect(prisma.image.updateMany).toHaveBeenCalledWith({
      where: { illustId: ILLUST_ID, pageIndex: 0 },
      data: { originalUrl: url, ext: 'jpg' },
    });
  });
});
