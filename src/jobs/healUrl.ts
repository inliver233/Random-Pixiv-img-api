import logger from '../logger/logger';
import { enqueue, work } from '../queue/queue';
import { healOriginalUrlsForIllust } from '../repositories/imagesRepo';
import { hydrateMetadata, type HydrateMetadataPage } from './hydrateMetadata';

export const HEAL_URL_JOB = 'heal_url';

export type HealUrlJobData = {
  illust_id: string;
};

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim() && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new Error('Invalid illust_id');
}

function normalizePages(pages: HydrateMetadataPage[], illustId: bigint): Array<{ pageIndex: number; ext: string; originalUrl: string }> {
  const out: Array<{ pageIndex: number; ext: string; originalUrl: string }> = [];

  for (const page of pages) {
    if (page.illustId !== illustId) {
      continue;
    }
    out.push({
      pageIndex: page.pageIndex,
      ext: page.ext,
      originalUrl: page.originalUrl,
    });
  }

  out.sort((a, b) => a.pageIndex - b.pageIndex);
  return out;
}

export async function healUrl(illustId: bigint): Promise<{ updated: number; pages: number }> {
  const pages = await hydrateMetadata(illustId);
  const normalized = normalizePages(pages, illustId);
  const updated = await healOriginalUrlsForIllust(illustId, normalized);
  return { updated, pages: normalized.length };
}

export async function enqueueHealUrl(illustId: bigint): Promise<string> {
  return enqueue<HealUrlJobData>(
    HEAL_URL_JOB,
    { illust_id: illustId.toString() },
    {
      retryLimit: 5,
      retryDelay: 60,
      retryBackoff: true,
      retryDelayMax: 3600,
    },
  );
}

export async function registerHealUrlWorker(): Promise<void> {
  await work<HealUrlJobData>(HEAL_URL_JOB, async (jobs) => {
    for (const job of jobs) {
      const jobData: any = job?.data ?? {};
      const illustId = toBigInt(jobData.illust_id ?? jobData.illustId ?? jobData.illust_id);

      const result = await healUrl(illustId);

      logger.info(
        {
          job: { name: HEAL_URL_JOB, id: job.id },
          illust_id: illustId.toString(),
          pages: result.pages,
          updated: result.updated,
        },
        'heal_url done',
      );
    }
  });
}

