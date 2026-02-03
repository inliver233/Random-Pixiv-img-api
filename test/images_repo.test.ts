import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import { IMAGE_STATUS_ACTIVE, IMAGE_STATUS_BROKEN, getById, markFail, markOk, pickRandom, upsert } from '../src/repositories/imagesRepo';

describe('imagesRepo', () => {
  const prisma = {
    $queryRaw: vi.fn(),
    image: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
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

  it('pickRandom uses two-phase random_key query and falls back when empty', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));

    prisma.image.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 3n });

    try {
      const res = await pickRandom({ xRestrict: 0, minWidth: 500 }, 0.5);

      const cutoff = new Date('2026-01-31T23:50:00.000Z');

      expect(prisma.image.findFirst).toHaveBeenNthCalledWith(1, {
        where: {
          status: IMAGE_STATUS_ACTIVE,
          width: { gte: 500 },
          AND: [
            { OR: [{ xRestrict: 0 }, { xRestrict: null }] },
            { OR: [{ lastFailAt: null }, { lastFailAt: { lt: cutoff } }] },
          ],
          randomKey: { gte: 0.5 },
        },
        orderBy: { randomKey: 'asc' },
      });

      expect(prisma.image.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          status: IMAGE_STATUS_ACTIVE,
          width: { gte: 500 },
          AND: [
            { OR: [{ xRestrict: 0 }, { xRestrict: null }] },
            { OR: [{ lastFailAt: null }, { lastFailAt: { lt: cutoff } }] },
          ],
        },
        orderBy: { randomKey: 'asc' },
      });

      expect(res).toEqual({ id: 3n });
    } finally {
      vi.useRealTimers();
    }
  });

  it('pickRandom uses SQL when minPixels filter is set', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: '5' }]);
    prisma.image.findUnique.mockResolvedValue({ id: 5n });

    const res = await pickRandom({ xRestrict: 0, minPixels: 1000000 }, 0.5);

    expect(prisma.image.findFirst).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);

    const firstQuery = prisma.$queryRaw.mock.calls[0]?.[0];
    expect(firstQuery?.sql).toContain('x_restrict IS NULL');

    expect(prisma.image.findUnique).toHaveBeenCalledWith({ where: { id: 5n } });
    expect(res).toEqual({ id: 5n });
  });
});
