import { getPrismaClient } from '../db/prismaClient';
import { getEnv } from '../config/env';
import { Prisma } from '../generated/prisma/client';

export const IMAGE_STATUS_ACTIVE = 1;
export const IMAGE_STATUS_DISABLED = 2;
export const IMAGE_STATUS_BROKEN = 3;

export type UpsertImageInput = {
  illustId: bigint;
  pageIndex: number;
  ext: string;
  originalUrl: string;
  proxyPath: string;
  randomKey: number;
  status?: number;

  width?: number | null;
  height?: number | null;
  aspectRatio?: number | null;
  orientation?: number | null;

  xRestrict?: number | null;
  aiType?: number | null;

  userId?: bigint | null;
  userName?: string | null;
  title?: string | null;
  createdAtPixiv?: Date | null;
};

export async function getById(id: bigint) {
  const prisma = getPrismaClient();
  return prisma.image.findUnique({ where: { id } });
}

export async function getByIdWithTags(id: bigint) {
  const prisma = getPrismaClient();
  return prisma.image.findUnique({
    where: { id },
    include: {
      imageTags: {
        include: {
          tag: true,
        },
      },
    },
  });
}

export async function upsert(input: UpsertImageInput) {
  const prisma = getPrismaClient();

  const {
    illustId,
    pageIndex,
    ext,
    originalUrl,
    proxyPath,
    randomKey,
    status,
    width,
    height,
    aspectRatio,
    orientation,
    xRestrict,
    aiType,
    userId,
    userName,
    title,
    createdAtPixiv,
  } = input;

  return prisma.image.upsert({
    where: {
      illustId_pageIndex: {
        illustId,
        pageIndex,
      },
    },
    create: {
      illustId,
      pageIndex,
      ext,
      originalUrl,
      proxyPath,
      randomKey,
      status: status ?? IMAGE_STATUS_ACTIVE,
      width,
      height,
      aspectRatio,
      orientation,
      xRestrict,
      aiType,
      userId,
      userName,
      title,
      createdAtPixiv,
    },
    update: {
      ext,
      originalUrl,
      proxyPath,
      randomKey,
      status,
      width,
      height,
      aspectRatio,
      orientation,
      xRestrict,
      aiType,
      userId,
      userName,
      title,
      createdAtPixiv,
    },
  });
}

export type MarkFailInput = {
  id: bigint;
  errorCode?: string;
  errorMsg?: string;
  status?: number;
};

export async function markFail(input: MarkFailInput) {
  const prisma = getPrismaClient();

  const { id, errorCode, errorMsg, status } = input;

  return prisma.image.update({
    where: { id },
    data: {
      failCount: { increment: 1 },
      lastFailAt: new Date(),
      lastErrorCode: errorCode,
      lastErrorMsg: errorMsg,
      status,
    },
  });
}

export type MarkOkInput = {
  id: bigint;
  status?: number;
};

export async function markOk(input: MarkOkInput) {
  const prisma = getPrismaClient();

  const { id, status } = input;

  return prisma.image.update({
    where: { id },
    data: {
      failCount: 0,
      lastOkAt: new Date(),
      lastErrorCode: null,
      lastErrorMsg: null,
      status,
    },
  });
}

export type PickRandomFilters = {
  xRestrict?: number | null;
  orientation?: number | null;
  minWidth?: number | null;
  minHeight?: number | null;
  minPixels?: number | null;
  includedTags?: string[] | null;
  excludedTags?: string[] | null;
};

export type PickRandomDebug = {
  pickedBy?: 'random_key' | 'tablesample';
};

export type PickRandomOptions = {
  strategy?: 'random_key' | 'tablesample';
  tablesamplePercent?: number;
  debug?: PickRandomDebug;
};

function buildPickRandomBaseWhere(filters: PickRandomFilters) {
  const where: any = {
    status: IMAGE_STATUS_ACTIVE,
  };

  if (filters.xRestrict !== undefined && filters.xRestrict !== null) {
    where.xRestrict = filters.xRestrict;
  }

  if (filters.orientation !== undefined && filters.orientation !== null && filters.orientation !== 0) {
    where.orientation = filters.orientation;
  }

  if (filters.minWidth !== undefined && filters.minWidth !== null) {
    where.width = { gte: filters.minWidth };
  }

  if (filters.minHeight !== undefined && filters.minHeight !== null) {
    where.height = { gte: filters.minHeight };
  }

  const env = getEnv();
  if (env.RANDOM_FAIL_COOLDOWN_MS > 0) {
    const cutoff = new Date(Date.now() - env.RANDOM_FAIL_COOLDOWN_MS);
    where.OR = [{ lastFailAt: null }, { lastFailAt: { lt: cutoff } }];
  }

  if (filters.includedTags !== undefined && filters.includedTags !== null && filters.includedTags.length > 0) {
    where.AND ??= [];
    for (const tagName of filters.includedTags) {
      where.AND.push({
        imageTags: {
          some: {
            tag: {
              name: tagName,
            },
          },
        },
      });
    }
  }

  if (filters.excludedTags !== undefined && filters.excludedTags !== null && filters.excludedTags.length > 0) {
    where.AND ??= [];
    where.AND.push({
      imageTags: {
        none: {
          tag: {
            name: { in: filters.excludedTags },
          },
        },
      },
    });
  }

  return where;
}

async function pickRandomByRandomKey(filters: PickRandomFilters, r: number) {
  if (filters.minPixels !== undefined && filters.minPixels !== null) {
    return pickRandomByRandomKeyRaw(filters, r);
  }

  const prisma = getPrismaClient();
  const baseWhere = buildPickRandomBaseWhere(filters);

  const first = await prisma.image.findFirst({
    where: {
      ...baseWhere,
      randomKey: { gte: r },
    },
    orderBy: { randomKey: 'asc' },
  });

  if (first) return first;

  return prisma.image.findFirst({
    where: baseWhere,
    orderBy: { randomKey: 'asc' },
  });
}

function buildPickRandomSqlConditions(filters: PickRandomFilters): Prisma.Sql[] {
  const env = getEnv();

  const conditions: Prisma.Sql[] = [Prisma.sql`status = ${IMAGE_STATUS_ACTIVE}`];

  if (filters.xRestrict !== undefined && filters.xRestrict !== null) {
    conditions.push(Prisma.sql`x_restrict = ${filters.xRestrict}`);
  }

  if (filters.orientation !== undefined && filters.orientation !== null && filters.orientation !== 0) {
    conditions.push(Prisma.sql`orientation = ${filters.orientation}`);
  }

  if (filters.minWidth !== undefined && filters.minWidth !== null) {
    conditions.push(Prisma.sql`width >= ${filters.minWidth}`);
  }

  if (filters.minHeight !== undefined && filters.minHeight !== null) {
    conditions.push(Prisma.sql`height >= ${filters.minHeight}`);
  }

  if (filters.minPixels !== undefined && filters.minPixels !== null) {
    conditions.push(Prisma.sql`(width * height) >= ${filters.minPixels}`);
  }

  if (filters.includedTags !== undefined && filters.includedTags !== null && filters.includedTags.length > 0) {
    const tagsSql = Prisma.join(filters.includedTags.map((tag) => Prisma.sql`${tag}`));
    const tagCount = filters.includedTags.length;

    conditions.push(
      Prisma.sql`
        id IN (
          SELECT it.image_id
          FROM image_tags it
          JOIN tags t ON t.id = it.tag_id
          WHERE t.name IN (${tagsSql})
          GROUP BY it.image_id
          HAVING COUNT(DISTINCT t.name) = ${tagCount}
        )
      `,
    );
  }

  if (filters.excludedTags !== undefined && filters.excludedTags !== null && filters.excludedTags.length > 0) {
    const tagsSql = Prisma.join(filters.excludedTags.map((tag) => Prisma.sql`${tag}`));

    conditions.push(
      Prisma.sql`
        id NOT IN (
          SELECT it.image_id
          FROM image_tags it
          JOIN tags t ON t.id = it.tag_id
          WHERE t.name IN (${tagsSql})
        )
      `,
    );
  }

  if (env.RANDOM_FAIL_COOLDOWN_MS > 0) {
    const cutoff = new Date(Date.now() - env.RANDOM_FAIL_COOLDOWN_MS);
    conditions.push(Prisma.sql`(last_fail_at IS NULL OR last_fail_at < ${cutoff})`);
  }

  return conditions;
}

async function pickRandomByRandomKeyRaw(filters: PickRandomFilters, r: number) {
  const prisma = getPrismaClient();

  const conditions = buildPickRandomSqlConditions(filters);

  const withRandomKey = Prisma.join([...conditions, Prisma.sql`random_key >= ${r}`], ' AND ');
  const firstRows = await prisma.$queryRaw<{ id: bigint | string }[]>(
    Prisma.sql`
      SELECT id
      FROM images
      WHERE ${withRandomKey}
      ORDER BY random_key ASC
      LIMIT 1
    `,
  );

  const fallbackRows = firstRows.length > 0
    ? firstRows
    : await prisma.$queryRaw<{ id: bigint | string }[]>(
      Prisma.sql`
        SELECT id
        FROM images
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY random_key ASC
        LIMIT 1
      `,
    );

  if (fallbackRows.length === 0) return null;

  const rawId = fallbackRows[0]?.id;
  if (rawId === undefined || rawId === null) return null;
  const id = typeof rawId === 'bigint' ? rawId : BigInt(rawId);

  return prisma.image.findUnique({ where: { id } });
}

function normalizeTablesamplePercent(input: number | undefined): number {
  const percent = input ?? 1;
  if (!Number.isFinite(percent)) return 1;
  if (percent <= 0) return 0.1;
  if (percent > 100) return 100;
  return percent;
}

async function pickRandomByTablesample(filters: PickRandomFilters, percent: number) {
  const prisma = getPrismaClient();
  const conditions = buildPickRandomSqlConditions(filters);

  const whereSql = Prisma.join(conditions, ' AND ');
  const percentSql = Prisma.raw(normalizeTablesamplePercent(percent).toString());

  const rows = await prisma.$queryRaw<{ id: bigint | string }[]>(
    Prisma.sql`
      SELECT id
      FROM images TABLESAMPLE SYSTEM (${percentSql})
      WHERE ${whereSql}
      LIMIT 1
    `,
  );

  if (rows.length === 0) return null;

  const rawId = rows[0]?.id;
  if (rawId === undefined || rawId === null) return null;
  const id = typeof rawId === 'bigint' ? rawId : BigInt(rawId);

  return prisma.image.findUnique({ where: { id } });
}

export async function pickRandom(filters: PickRandomFilters, r: number, options?: PickRandomOptions) {
  const debug = options?.debug;
  const strategy = options?.strategy ?? 'random_key';

  if (strategy === 'tablesample') {
    if (debug) debug.pickedBy = 'tablesample';
    return pickRandomByTablesample(filters, options?.tablesamplePercent ?? 1);
  }

  if (debug) debug.pickedBy = 'random_key';
  return pickRandomByRandomKey(filters, r);
}
