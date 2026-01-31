import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import { syncImageTags, upsertTag } from '../src/repositories/tagsRepo';

describe('tagsRepo', () => {
  const prisma = {
    tag: {
      upsert: vi.fn(),
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
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    vi.clearAllMocks();
  });

  it('upsertTag upserts by name', async () => {
    prisma.tag.upsert.mockResolvedValue({ id: 1n, name: 'tag' });

    const res = await upsertTag({ name: ' tag ' });

    expect(prisma.tag.upsert).toHaveBeenCalledWith({
      where: { name: 'tag' },
      create: { name: 'tag', translatedName: undefined },
      update: { translatedName: undefined },
    });
    expect(res).toEqual({ id: 1n, name: 'tag' });
  });

  it('syncImageTags diffs relations (add/remove) and de-dupes input', async () => {
    prisma.tag.upsert
      .mockResolvedValueOnce({ id: 1n, name: 'a' })
      .mockResolvedValueOnce({ id: 3n, name: 'b' });

    prisma.imageTag.findMany.mockResolvedValue([{ tagId: 1n }, { tagId: 2n }]);
    prisma.imageTag.createMany.mockResolvedValue({ count: 1 });
    prisma.imageTag.deleteMany.mockResolvedValue({ count: 1 });

    const res = await syncImageTags(10n, [{ name: 'a' }, { name: 'b' }, { name: 'b' }]);

    expect(prisma.tag.upsert).toHaveBeenCalledTimes(2);

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
    prisma.tag.upsert.mockResolvedValue({ id: 1n, name: 'a' });
    prisma.imageTag.findMany.mockResolvedValue([{ tagId: 1n }]);

    const res = await syncImageTags(10n, [{ name: 'a' }]);

    expect(prisma.imageTag.createMany).not.toHaveBeenCalled();
    expect(prisma.imageTag.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(res).toEqual({ added: 0, removed: 0 });
  });
});

