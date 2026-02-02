import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import { hydrateMetadata, persistHydratedMetadata } from '../src/jobs/hydrateMetadata';
import pixivService from '../src/services/pixivService';

const ILLUST_ID = 12345678n;

function originalUrl(illustId: bigint, pageIndex: number, ext = 'jpg') {
  return `https://i.pximg.net/img-original/img/2020/01/01/00/00/00/${illustId.toString()}_p${pageIndex}.${ext}`;
}

describe('hydrate_metadata fields: title/created_at_pixiv', () => {
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

  it('maps title/created_at_pixiv and persists to DB', async () => {
    const url = originalUrl(ILLUST_ID, 0);

    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 1,
        title: 'unit-test-title',
        create_date: '2020-01-01T00:00:00Z',
        image_urls: { square_medium: 'https://example.invalid/square.jpg' },
        meta_single_page: { original_image_url: url },
        meta_pages: [],
      },
    } as any);

    const pages = await hydrateMetadata(ILLUST_ID);
    expect(pages[0]).toMatchObject({ title: 'unit-test-title' });
    expect(pages[0].createdAtPixiv?.toISOString()).toBe('2020-01-01T00:00:00.000Z');

    prisma.image.updateMany.mockResolvedValueOnce({ count: 1 });
    const updated = await persistHydratedMetadata(ILLUST_ID, pages);
    expect(updated).toBe(1);

    expect(prisma.image.updateMany).toHaveBeenCalledWith({
      where: { illustId: ILLUST_ID, pageIndex: 0 },
      data: { originalUrl: url, ext: 'jpg', title: 'unit-test-title', createdAtPixiv: expect.any(Date) },
    });
  });

  it('skips invalid created_at_pixiv but still persists title', async () => {
    const url = originalUrl(ILLUST_ID, 0);

    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 1,
        title: 'unit-test-title',
        create_date: 'not-a-date',
        image_urls: { square_medium: 'https://example.invalid/square.jpg' },
        meta_single_page: { original_image_url: url },
        meta_pages: [],
      },
    } as any);

    const pages = await hydrateMetadata(ILLUST_ID);
    expect(pages[0]).toMatchObject({ title: 'unit-test-title', createdAtPixiv: null });

    prisma.image.updateMany.mockResolvedValueOnce({ count: 1 });
    const updated = await persistHydratedMetadata(ILLUST_ID, pages);
    expect(updated).toBe(1);

    expect(prisma.image.updateMany).toHaveBeenCalledWith({
      where: { illustId: ILLUST_ID, pageIndex: 0 },
      data: { originalUrl: url, ext: 'jpg', title: 'unit-test-title' },
    });
  });

  it('skips empty title but still persists created_at_pixiv', async () => {
    const url = originalUrl(ILLUST_ID, 0);

    vi.spyOn(pixivService, 'getPixivIllustIdData').mockResolvedValueOnce({
      illust: {
        id: Number(ILLUST_ID),
        page_count: 1,
        title: '   ',
        create_date: '2020-01-01T00:00:00Z',
        image_urls: { square_medium: 'https://example.invalid/square.jpg' },
        meta_single_page: { original_image_url: url },
        meta_pages: [],
      },
    } as any);

    const pages = await hydrateMetadata(ILLUST_ID);
    expect(pages[0]).toMatchObject({ title: null });
    expect(pages[0].createdAtPixiv?.toISOString()).toBe('2020-01-01T00:00:00.000Z');

    prisma.image.updateMany.mockResolvedValueOnce({ count: 1 });
    const updated = await persistHydratedMetadata(ILLUST_ID, pages);
    expect(updated).toBe(1);

    expect(prisma.image.updateMany).toHaveBeenCalledWith({
      where: { illustId: ILLUST_ID, pageIndex: 0 },
      data: { originalUrl: url, ext: 'jpg', createdAtPixiv: expect.any(Date) },
    });
  });
});
