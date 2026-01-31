import { getPrismaClient } from '../../db/prismaClient';
import { generateRandomKey } from '../../domain/randomKey';
import { upsert, type UpsertImageInput } from '../../repositories/imagesRepo';

export type UpsertImageForImportInput = Omit<UpsertImageInput, 'randomKey'> & {
  randomKey?: number;
};

export async function upsertImageForImport(input: UpsertImageForImportInput) {
  const { randomKey, ...rest } = input;
  return upsert({
    ...rest,
    randomKey: randomKey ?? generateRandomKey(),
  });
}

export async function resetImageRandomKey(id: bigint) {
  const prisma = getPrismaClient();
  return prisma.image.update({
    where: { id },
    data: { randomKey: generateRandomKey() },
  });
}

