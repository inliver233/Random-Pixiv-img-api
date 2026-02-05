import { Prisma, type HydrationRunStatus, type HydrationRunType } from '@prisma/client';

import { getPrismaClient } from '../db/prismaClient';

export type CreateHydrationRunInput = {
  type: HydrationRunType;
  status?: HydrationRunStatus;
  requestedBy?: string | null;
  criteria?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  cursor?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
};

export async function createHydrationRun(input: CreateHydrationRunInput) {
  const prisma = getPrismaClient();

  return prisma.hydrationRun.create({
    data: {
      type: input.type,
      status: input.status,
      requestedBy: input.requestedBy,
      criteria: input.criteria ?? Prisma.JsonNull,
      cursor: input.cursor ?? Prisma.JsonNull,
    },
  });
}

export async function getHydrationRunById(id: bigint) {
  const prisma = getPrismaClient();
  return prisma.hydrationRun.findUnique({ where: { id } });
}

export type UpdateHydrationRunInput = {
  id: bigint;
  status?: HydrationRunStatus;
  criteria?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  cursor?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  total?: number | null;
  processed?: number;
  success?: number;
  failed?: number;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  lastErrorCode?: string | null;
  lastErrorMsg?: string | null;
};

export async function updateHydrationRun(input: UpdateHydrationRunInput) {
  const prisma = getPrismaClient();

  const {
    id,
    status,
    criteria,
    cursor,
    total,
    processed,
    success,
    failed,
    startedAt,
    finishedAt,
    lastErrorCode,
    lastErrorMsg,
  } = input;

  return prisma.hydrationRun.update({
    where: { id },
    data: {
      status,
      criteria,
      cursor,
      total,
      processed,
      success,
      failed,
      startedAt,
      finishedAt,
      lastErrorCode,
      lastErrorMsg,
    },
  });
}
