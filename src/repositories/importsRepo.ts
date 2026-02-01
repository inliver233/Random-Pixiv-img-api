import { getPrismaClient } from '../db/prismaClient';
import type { Prisma } from '@prisma/client';

export type CreateImportInput = {
  total: number;
  createdBy?: string | null;
  source?: string | null;
  success?: number;
  failed?: number;
  detail?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
};

export async function createImport(input: CreateImportInput) {
  const prisma = getPrismaClient();
  return prisma.import.create({
    data: {
      total: input.total,
      createdBy: input.createdBy,
      source: input.source,
      success: input.success ?? 0,
      failed: input.failed ?? 0,
      detail: input.detail,
    },
  });
}

export type UpdateImportInput = {
  id: bigint;
  total?: number;
  createdBy?: string | null;
  source?: string | null;
  success?: number;
  failed?: number;
  detail?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
};

export async function updateImport(input: UpdateImportInput) {
  const prisma = getPrismaClient();

  const { id, total, createdBy, source, success, failed, detail } = input;

  return prisma.import.update({
    where: { id },
    data: {
      total,
      createdBy,
      source,
      success,
      failed,
      detail,
    },
  });
}

export async function getById(id: bigint) {
  const prisma = getPrismaClient();
  return prisma.import.findUnique({ where: { id } });
}
