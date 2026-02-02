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
