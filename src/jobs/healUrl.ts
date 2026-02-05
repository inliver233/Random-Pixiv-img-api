import logger from '../logger/logger';
import { getEnv } from '../config/env';
import { recordJobFail, recordJobSuccess } from '../metrics/jobMetrics';
import { enqueue, ensureQueue, work } from '../queue/queue';
import { healOriginalUrlsForIllust } from '../repositories/imagesRepo';
import { hydrateMetadata, type HydrateMetadataPage } from './hydrateMetadata';

export const HEAL_URL_JOB = 'heal_url';

export type HealUrlJobData = {
  illust_id: string;
  request_id?: string;
};

function normalizeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

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
  const pages = await hydrateMetadata(illustId, { cache: false });
  const normalized = normalizePages(pages, illustId);
  const updated = await healOriginalUrlsForIllust(illustId, normalized);
  return { updated, pages: normalized.length };
}

export async function enqueueHealUrl(illustId: bigint, requestId?: string): Promise<string | null> {
  const env = getEnv();
  const options = {
    retryLimit: env.HEAL_RETRY_LIMIT,
    retryDelay: env.HEAL_RETRY_DELAY_SECONDS,
    retryBackoff: env.HEAL_RETRY_BACKOFF,
    retryDelayMax: env.HEAL_RETRY_DELAY_MAX_SECONDS,
  };

  const payload: HealUrlJobData = { illust_id: illustId.toString() };
  const normalizedRequestId = normalizeRequestId(requestId);
  if (normalizedRequestId) payload.request_id = normalizedRequestId;

  const debounceSeconds = Math.max(0, Math.trunc(env.HEAL_DEBOUNCE_SECONDS));
  if (debounceSeconds === 0) {
    return enqueue<HealUrlJobData>(HEAL_URL_JOB, payload, options);
  }

  const boss = await ensureQueue(HEAL_URL_JOB);
  const jobId = await boss.sendThrottled(
    HEAL_URL_JOB,
    payload,
    options,
    debounceSeconds,
    illustId.toString(),
  );

  return jobId ?? null;
}

export async function registerHealUrlWorker(): Promise<void> {
  await work<HealUrlJobData>(HEAL_URL_JOB, async (jobs) => {
    for (const job of jobs) {
      const jobData: any = job?.data ?? {};
      const illustId = toBigInt(jobData.illust_id ?? jobData.illustId ?? jobData.illust_id);
      const requestId = normalizeRequestId(jobData.request_id ?? jobData.requestId);

      const startedAt = process.hrtime.bigint();
      try {
        const result = await healUrl(illustId);
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        recordJobSuccess({ job: HEAL_URL_JOB, illustId: illustId.toString(), durationSeconds });

        logger.info(
          {
            request_id: requestId,
            job: { name: HEAL_URL_JOB, id: job.id },
            illust_id: illustId.toString(),
            pages: result.pages,
            updated: result.updated,
            duration_seconds: durationSeconds,
          },
          'heal_url done',
        );
      } catch (err: unknown) {
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        recordJobFail({ job: HEAL_URL_JOB, illustId: illustId.toString(), durationSeconds });
        const evidence = (err as any)?.failoverEvidence;
        const attempts = Array.isArray(evidence?.attempts) ? evidence.attempts : [];
        logger.warn(
          {
            request_id: requestId,
            job: { name: HEAL_URL_JOB, id: job.id },
            illust_id: illustId.toString(),
            duration_seconds: durationSeconds,
            failover_attempts: attempts.length,
            failover_last_attempt: attempts.length > 0 ? attempts[attempts.length - 1] : null,
            err,
          },
          'heal_url failed',
        );
        throw err;
      }
    }
  });
}
