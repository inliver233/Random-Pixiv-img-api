import { Prisma } from '@prisma/client';
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

export type BulkUpsertImageForImportRow = {
  illustId: bigint;
  pageIndex: number;
  ext: string;
  originalUrl: string;
  proxyPath: string;
};

export async function bulkUpsertImagesForImport(rows: BulkUpsertImageForImportRow[]): Promise<void> {
  if (rows.length === 0) return;

  const prisma = getPrismaClient();

  const values = rows.map((row) => Prisma.sql`(
      ${row.illustId},
      ${row.pageIndex},
      ${row.ext},
      ${row.originalUrl},
      ${row.proxyPath},
      random()
    )`);

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO images (illust_id, page_index, ext, original_url, proxy_path, random_key)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (illust_id, page_index) DO UPDATE SET
        ext = EXCLUDED.ext,
        original_url = EXCLUDED.original_url,
        proxy_path = EXCLUDED.proxy_path,
        random_key = EXCLUDED.random_key,
        updated_at = now()
    `,
  );
}

export async function resetImageRandomKey(id: bigint) {
  const prisma = getPrismaClient();
  return prisma.image.update({
    where: { id },
    data: { randomKey: generateRandomKey() },
  });
}
