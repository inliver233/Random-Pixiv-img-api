import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import { syncImageTags, upsertTag } from '../src/repositories/tagsRepo';

describe('tagsRepo', () => {
  const prisma = {
    tag: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    imageTag: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  } as any;

  beforeEach(() => {
    setPrismaClientForTest(prisma);
    prisma.tag.findFirst.mockReset();
    prisma.tag.create.mockReset();
    prisma.tag.update.mockReset();
    prisma.tag.findUniqueOrThrow.mockReset();
    prisma.imageTag.findMany.mockReset();
    prisma.imageTag.createMany.mockReset();
    prisma.imageTag.deleteMany.mockReset();
    prisma.$transaction.mockClear();
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    vi.clearAllMocks();
  });

  it('upsertTag upserts by name', async () => {
    prisma.tag.findFirst.mockResolvedValue(null);
    prisma.tag.create.mockResolvedValue({ id: 1n, name: 'tag' });

    const res = await upsertTag({ name: ' tag ' });

    expect(prisma.tag.findFirst).toHaveBeenCalledWith({
      where: {
        name: {
          equals: 'tag',
          mode: 'insensitive',
        },
      },
      select: { id: true },
    });
    expect(prisma.tag.create).toHaveBeenCalledWith({
      data: { name: 'tag', translatedName: undefined },
    });
    expect(res).toEqual({ id: 1n, name: 'tag' });
  });

  it('syncImageTags diffs relations (add/remove) and de-dupes input', async () => {
    prisma.tag.findFirst.mockResolvedValue(null);
    prisma.tag.create
      .mockResolvedValueOnce({ id: 1n, name: 'a' })
      .mockResolvedValueOnce({ id: 3n, name: 'b' });

    prisma.imageTag.findMany.mockResolvedValue([{ tagId: 1n }, { tagId: 2n }]);
    prisma.imageTag.createMany.mockResolvedValue({ count: 1 });
    prisma.imageTag.deleteMany.mockResolvedValue({ count: 1 });

    const res = await syncImageTags(10n, [{ name: 'a' }, { name: 'b' }, { name: 'b' }]);

    expect(prisma.tag.create).toHaveBeenCalledTimes(2);

    expect(prisma.imageTag.createMany).toHaveBeenCalledWith({
      data: [{ imageId: 10n, tagId: 3n }],
      skipDuplicates: true,
    });
    expect(prisma.imageTag.deleteMany).toHaveBeenCalledWith({
      where: { imageId: 10n, tagId: { in: [2n] } },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ added: 1, removed: 1 });
  });

  it('syncImageTags returns early when no changes', async () => {
    prisma.tag.findFirst.mockResolvedValue(null);
    prisma.tag.create.mockResolvedValue({ id: 1n, name: 'a' });
    prisma.imageTag.findMany.mockResolvedValue([{ tagId: 1n }]);

    const res = await syncImageTags(10n, [{ name: 'a' }]);

    expect(prisma.imageTag.createMany).not.toHaveBeenCalled();
    expect(prisma.imageTag.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(res).toEqual({ added: 0, removed: 0 });
  });
});
