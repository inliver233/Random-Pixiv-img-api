import type { Prisma } from '@prisma/client';

import { getPrismaClient } from '../db/prismaClient';

export type AuthorSearchParams = {
  q?: string | null;
  limit: number;
  cursor?: bigint | null;
};

export type AuthorSearchItem = {
  userId: bigint;
  userName: string | null;
  imageCount: number;
};

function normalizeOptionalQuery(value: string | null | undefined): string | undefined {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : undefined;
}

function tryParsePositiveBigInt(value: string | undefined): bigint | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  try {
    const id = BigInt(value);
    if (id < 1n) return null;
    return id;
  } catch {
    return null;
  }
}

export async function searchAuthors(params: AuthorSearchParams): Promise<{ items: AuthorSearchItem[]; nextCursor: bigint | null }> {
  const prisma = getPrismaClient();

  const q = normalizeOptionalQuery(params.q);
  const qUserId = tryParsePositiveBigInt(q);
  const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 20)));
  const cursor = params.cursor ?? null;

  const and: Prisma.ImageWhereInput[] = [
    { userId: { not: null } },
  ];

  if (qUserId) {
    and.push({ userId: qUserId });
  } else {
    if (q) {
      and.push({ userName: { contains: q, mode: 'insensitive' } });
    }
    if (cursor) {
      and.push({ userId: { gt: cursor } });
    }
  }

  const where: Prisma.ImageWhereInput = and.length > 1 ? { AND: and } : and[0]!;

  const grouped = await (prisma as any).image.groupBy({
    by: ['userId'],
    where,
    _count: { _all: true },
    orderBy: { userId: 'asc' },
    take: limit + 1,
  }) as Array<{ userId: bigint; _count: { _all: number } }>;

  const hasMore = grouped.length > limit;
  const pageRows = hasMore ? grouped.slice(0, limit) : grouped;
  const nextCursor = hasMore ? pageRows[pageRows.length - 1]!.userId : null;

  const userIds = pageRows.map((row) => row.userId);
  const nameRows = userIds.length === 0
    ? []
    : await prisma.image.findMany({
      where: {
        userId: { in: userIds },
        userName: { not: null },
      },
      distinct: ['userId'],
      orderBy: { updatedAt: 'desc' },
      select: { userId: true, userName: true },
    });

  const nameById = new Map<string, string>();
  for (const row of nameRows as any[]) {
    if (!row?.userId) continue;
    if (!row?.userName) continue;
    nameById.set(String(row.userId), String(row.userName));
  }

  return {
    items: pageRows.map((row) => ({
      userId: row.userId,
      userName: nameById.get(String(row.userId)) ?? null,
      imageCount: Number(row?._count?._all ?? 0),
    })),
    nextCursor,
  };
}

