import { getPrismaClient } from '../db/prismaClient';

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

