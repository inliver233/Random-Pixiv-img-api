import logger from '../logger/logger';
import { getPrismaClient } from '../db/prismaClient';
import pixivService from '../services/pixivService';
import { computeGeometryFromWidthHeight, normalizePositiveInt } from '../domain/imageGeometry';
import { parsePixivUrl } from '../utils/parsePixivUrl';
import { enqueue, work } from '../queue/queue';

export const HYDRATE_METADATA_JOB = 'hydrate_metadata';

export type HydrateMetadataJobData = {
  illust_id: string;
};

export type HydrateMetadataPage = {
  illustId: bigint;
  pageIndex: number;
  ext: string;
  originalUrl: string;
  width: number | null;
  height: number | null;
  orientation: number | null;
  aspectRatio: number | null;
  xRestrict: number | null;
  userId: bigint | null;
  userName: string | null;
  title: string | null;
  createdAtPixiv: Date | null;
};

export type HydrateMetadataOptions = {
  cache?: boolean;
};

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim() && /^\\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new Error('Invalid illust_id');
}

function normalizeOriginalUrls(pixivDetail: any): string[] {
  const illust = pixivDetail?.illust;
  if (!illust || typeof illust !== 'object') {
    throw new Error('Invalid Pixiv response: missing illust');
  }

  const pageCount = Number(illust.page_count ?? 0);
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    throw new Error('Invalid Pixiv response: page_count');
  }

  if (pageCount === 1) {
    const url = illust?.meta_single_page?.original_image_url;
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Invalid Pixiv response: missing original_image_url');
    }
    return [url.trim()];
  }

  const pages = Array.isArray(illust.meta_pages) ? illust.meta_pages : [];
  const urls = pages
    .map((p: any) => p?.image_urls?.original)
    .filter((u: any) => typeof u === 'string' && u.trim() !== '')
    .map((u: string) => u.trim());

  if (urls.length !== pageCount) {
    throw new Error('Invalid Pixiv response: meta_pages length mismatch');
  }

  return urls;
}

function normalizeXRestrict(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (!Number.isSafeInteger(n)) return null;
  if (n < 0 || n > 2) return null;
  return n;
}

function normalizePositiveBigInt(value: unknown): bigint | null {
  if (value === undefined || value === null) return null;

  if (typeof value === 'bigint') {
    return value > 0n ? value : null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (!Number.isSafeInteger(value)) return null;
    if (value <= 0) return null;
    return BigInt(value);
  }

  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;

  try {
    const n = BigInt(raw);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

function normalizeNonEmptyText(value: unknown): string | null {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  const text = raw.trim();
  return text ? text : null;
}

function normalizeDate(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  // Invalid Date -> NaN
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function hydrateMetadata(illustId: bigint, options: HydrateMetadataOptions = {}): Promise<HydrateMetadataPage[]> {
  const cache = options.cache ?? true;
  const data = await pixivService.getPixivIllustIdData(illustId.toString(), cache);
  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error('Pixiv API returned error');
  }

  const urls = normalizeOriginalUrls(data);
  const illust = data?.illust ?? {};
  const geometry = computeGeometryFromWidthHeight(
    normalizePositiveInt((illust as any).width),
    normalizePositiveInt((illust as any).height),
  );
  const xRestrict = normalizeXRestrict((illust as any).x_restrict ?? (illust as any).xRestrict);
  const userId = normalizePositiveBigInt((illust as any)?.user?.id ?? (illust as any)?.userId);
  const userName = normalizeNonEmptyText((illust as any)?.user?.name ?? (illust as any)?.userName);
  const title = normalizeNonEmptyText((illust as any).title);
  const createdAtPixiv = normalizeDate((illust as any).create_date ?? (illust as any).created_at ?? (illust as any).createdAt);

  const pages: HydrateMetadataPage[] = [];
  for (const url of urls) {
    const parsed = parsePixivUrl(url);
    if (!parsed.ok) {
      throw new Error(`Unsupported Pixiv original url: ${parsed.code}`);
    }
    pages.push({
      illustId: parsed.illustId,
      pageIndex: parsed.pageIndex,
      ext: parsed.ext,
      originalUrl: url,
      width: geometry.width,
      height: geometry.height,
      orientation: geometry.orientation,
      aspectRatio: geometry.aspectRatio,
      xRestrict,
      userId,
      userName,
      title,
      createdAtPixiv,
    });
  }

  pages.sort((a, b) => a.pageIndex - b.pageIndex);
  return pages;
}

export async function persistHydratedMetadata(illustId: bigint, pages: HydrateMetadataPage[]): Promise<number> {
  if (pages.length === 0) return 0;

  const prisma = getPrismaClient();
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    for (const page of pages) {
      const data: any = {};

      if (page.width !== null && page.height !== null) {
        data.width = page.width;
        data.height = page.height;
        data.orientation = page.orientation;
        data.aspectRatio = page.aspectRatio;
      }

      if (page.xRestrict !== null) {
        data.xRestrict = page.xRestrict;
      }

      if (page.userId !== null) {
        data.userId = page.userId;
      }

      if (page.userName !== null) {
        data.userName = page.userName;
      }

      if (page.title !== null) {
        data.title = page.title;
      }

      if (page.createdAtPixiv !== null) {
        data.createdAtPixiv = page.createdAtPixiv;
      }

      if (Object.keys(data).length === 0) continue;

      const res = await tx.image.updateMany({
        where: { illustId, pageIndex: page.pageIndex },
        data,
      });
      updated += res.count;
    }
  });

  return updated;
}

export async function enqueueHydrateMetadata(illustId: bigint): Promise<string> {
  return enqueue<HydrateMetadataJobData>(HYDRATE_METADATA_JOB, { illust_id: illustId.toString() });
}

export async function registerHydrateMetadataWorker(): Promise<void> {
  await work<HydrateMetadataJobData>(HYDRATE_METADATA_JOB, async (jobs) => {
    for (const job of jobs) {
      const jobData: any = job?.data ?? {};
      const illustId = toBigInt(jobData.illust_id ?? jobData.illustId ?? jobData.illust_id);

      const pages = await hydrateMetadata(illustId);
      const updated = await persistHydratedMetadata(illustId, pages);

      logger.info(
        {
          job: { name: HYDRATE_METADATA_JOB, id: job.id },
          illust_id: illustId.toString(),
          pages: pages.length,
          updated,
        },
        'hydrate_metadata done',
      );
    }
  });
}
