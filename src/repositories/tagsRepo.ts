import { getPrismaClient } from '../db/prismaClient';
import { Prisma } from '@prisma/client';

export type UpsertTagInput = {
  name: string;
  translatedName?: string | null;
};

function normalizeTagName(value: string): string {
  return value.trim();
}

function normalizeTranslatedName(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export async function upsertTag(input: UpsertTagInput) {
  const prisma = getPrismaClient();
  const name = normalizeTagName(input.name);
  const translatedName = normalizeTranslatedName(input.translatedName);

  if (!name) {
    throw new Error('Tag name is required.');
  }

  const existing = await prisma.tag.findFirst({
    where: {
      name: {
        equals: name,
        mode: 'insensitive',
      },
    },
    select: { id: true },
  });

  if (existing) {
    if (translatedName !== undefined) {
      return prisma.tag.update({ where: { id: existing.id }, data: { translatedName } });
    }
    return prisma.tag.findUniqueOrThrow({ where: { id: existing.id } });
  }

  return prisma.tag.create({ data: { name, translatedName } });
}

export async function syncImageTags(imageId: bigint, tags: UpsertTagInput[]) {
  const prisma = getPrismaClient();

  const uniqueTagsByName = new Map<string, UpsertTagInput>();
  for (const tag of tags) {
    const name = normalizeTagName(tag.name);
    if (!name) continue;

    const key = name.toLowerCase();

    const existing = uniqueTagsByName.get(key);
    if (!existing) {
      uniqueTagsByName.set(key, tag);
      continue;
    }

    // Prefer a tag that includes translatedName.
    if (!existing.translatedName && tag.translatedName) {
      uniqueTagsByName.set(key, tag);
    }
  }

  const desiredTags = await Promise.all([...uniqueTagsByName.values()].map((tag) => upsertTag(tag)));
  const desiredTagIds = desiredTags.map((tag: any) => tag.id as bigint);

  const existing = await prisma.imageTag.findMany({
    where: { imageId },
    select: { tagId: true },
  });

  const existingTagIds = new Set(existing.map((row: any) => row.tagId as bigint));
  const desiredTagIdsSet = new Set(desiredTagIds);

  const tagIdsToAdd = desiredTagIds.filter((tagId) => !existingTagIds.has(tagId));
  const tagIdsToRemove = [...existingTagIds].filter((tagId) => !desiredTagIdsSet.has(tagId));

  if (tagIdsToAdd.length === 0 && tagIdsToRemove.length === 0) {
    return { added: 0, removed: 0 };
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (tagIdsToAdd.length > 0) {
    ops.push(
      prisma.imageTag.createMany({
        data: tagIdsToAdd.map((tagId) => ({ imageId, tagId })),
        skipDuplicates: true,
      }),
    );
  }

  if (tagIdsToRemove.length > 0) {
    ops.push(
      prisma.imageTag.deleteMany({
        where: {
          imageId,
          tagId: { in: tagIdsToRemove },
        },
      }),
    );
  }

  await prisma.$transaction(ops);

  return { added: tagIdsToAdd.length, removed: tagIdsToRemove.length };
}

export type TagSearchParams = {
  q?: string | null;
  limit: number;
  cursor?: bigint | null;
};

export type TagSearchItem = {
  id: bigint;
  name: string;
  translatedName: string | null;
  imageCount: number;
};

function normalizeOptionalQuery(value: string | null | undefined): string | undefined {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : undefined;
}

export async function searchTags(params: TagSearchParams): Promise<{ items: TagSearchItem[]; nextCursor: bigint | null }> {
  const prisma = getPrismaClient();

  const q = normalizeOptionalQuery(params.q);
  const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 20)));
  const cursor = params.cursor ?? null;

  const and: Prisma.TagWhereInput[] = [];
  if (cursor) {
    and.push({ id: { gt: cursor } });
  }

  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { translatedName: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.TagWhereInput = and.length > 0 ? { AND: and } : {};

  const rows = await prisma.tag.findMany({
    where,
    orderBy: { id: 'asc' },
    take: limit + 1,
    select: {
      id: true,
      name: true,
      translatedName: true,
      _count: { select: { imageTags: true } },
    },
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? pageRows[pageRows.length - 1]!.id : null;

  return {
    items: pageRows.map((row: any) => ({
      id: row.id as bigint,
      name: String(row.name || ''),
      translatedName: row.translatedName ?? null,
      imageCount: Number(row?._count?.imageTags ?? 0),
    })),
    nextCursor,
  };
}
