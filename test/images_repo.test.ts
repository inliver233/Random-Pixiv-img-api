import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import { IMAGE_STATUS_ACTIVE, IMAGE_STATUS_BROKEN, getById, markFail, markOk, upsert } from '../src/repositories/imagesRepo';

describe('imagesRepo', () => {
  const prisma = {
    image: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    setPrismaClientForTest(prisma);
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    vi.clearAllMocks();
  });

  it('getById queries by id', async () => {
    const id = 123n;
    prisma.image.findUnique.mockResolvedValue({ id });

    const result = await getById(id);

    expect(prisma.image.findUnique).toHaveBeenCalledWith({ where: { id } });
    expect(result).toEqual({ id });
  });

  it('upsert upserts by (illustId, pageIndex) and defaults status=active for create', async () => {
    prisma.image.upsert.mockResolvedValue({ id: 1n });

    await upsert({
      illustId: 987n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'https://i.pximg.net/img-original/img/xxx.jpg',
      proxyPath: '/i/1.jpg',
      randomKey: 0.123,
    });

    expect(prisma.image.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          illustId_pageIndex: { illustId: 987n, pageIndex: 0 },
        },
        create: expect.objectContaining({
          illustId: 987n,
          pageIndex: 0,
          status: IMAGE_STATUS_ACTIVE,
          randomKey: 0.123,
        }),
        update: expect.objectContaining({
          randomKey: 0.123,
        }),
      }),
    );
  });

  it('markFail increments failCount and stores error details atomically', async () => {
    prisma.image.update.mockResolvedValue({ id: 1n });

    await markFail({
      id: 1n,
      errorCode: 'upstream_404',
      errorMsg: 'not found',
      status: IMAGE_STATUS_BROKEN,
    });

    expect(prisma.image.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: {
        failCount: { increment: 1 },
        lastFailAt: expect.any(Date),
        lastErrorCode: 'upstream_404',
        lastErrorMsg: 'not found',
        status: IMAGE_STATUS_BROKEN,
      },
    });
  });

  it('markOk resets failCount and clears last error fields atomically', async () => {
    prisma.image.update.mockResolvedValue({ id: 2n });

    await markOk({
      id: 2n,
      status: IMAGE_STATUS_ACTIVE,
    });

    expect(prisma.image.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: {
        failCount: 0,
        lastOkAt: expect.any(Date),
        lastErrorCode: null,
        lastErrorMsg: null,
        status: IMAGE_STATUS_ACTIVE,
      },
    });
  });
});

