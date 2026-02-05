import { Prisma } from '@prisma/client';

import logger from '../logger/logger';
import { getPrismaClient } from '../db/prismaClient';
import { recordJobFail, recordJobSuccess } from '../metrics/jobMetrics';
import { ensureQueue, work } from '../queue/queue';
import { IMAGE_STATUS_DISABLED } from '../repositories/imagesRepo';

import { enqueueHydrateMetadata } from './hydrateMetadata';

export const HYDRATION_BACKFILL_JOB = 'hydration_backfill';

export type HydrationBackfillJobData = {
  run_id: string;
  request_id?: string;
};

type NormalizedBackfillCriteria = {
  batchSize: number;
  yearFrom: number | null;
  yearTo: number | null;
  userId: bigint | null;
  includedTags: string[];
  excludedTags: string[];
  missingFields: string[];
};

type NormalizedBackfillCursor = {
  lastIllustId: bigint | null;
};

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 2000;
const MAX_BATCHES_PER_JOB = 5;

function normalizeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\n|]/g)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return [];
}

function coerceBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function coerceInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function toBigInt(value: unknown): bigint | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim() && /^\\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

function normalizeBatchSize(value: unknown): number {
  const n = coerceInt(value);
  if (!n || !Number.isSafeInteger(n) || n <= 0) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, n));
}

function normalizeYear(value: unknown): number | null {
  const n = coerceInt(value);
  if (!n || !Number.isSafeInteger(n)) return null;
  if (n < 1970 || n > 2500) return null;
  return n;
}

function normalizeCriteria(criteria: unknown): NormalizedBackfillCriteria {
  const record = criteria && typeof criteria === 'object' ? (criteria as Record<string, unknown>) : {};

  const year = normalizeYear(record.year);
  let yearFrom = normalizeYear(record.year_from ?? record.yearFrom ?? record.from_year ?? record.fromYear);
  let yearTo = normalizeYear(record.year_to ?? record.yearTo ?? record.to_year ?? record.toYear);

  if (year !== null) {
    yearFrom = year;
    yearTo = year;
  }

  if (yearFrom !== null && yearTo === null) {
    yearTo = yearFrom;
  } else if (yearTo !== null && yearFrom === null) {
    yearFrom = yearTo;
  }

  if (yearFrom !== null && yearTo !== null && yearTo < yearFrom) {
    const tmp = yearFrom;
    yearFrom = yearTo;
    yearTo = tmp;
  }

  const includedTags = coerceStringArray(record.included_tags ?? record.includedTags);
  const excludedTags = coerceStringArray(record.excluded_tags ?? record.excludedTags);

  const missingFields = coerceStringArray(record.missing_fields ?? record.missingFields);
  const missingMetadata = coerceBoolean(record.missing_metadata ?? record.missingMetadata, false);
  const normalizedMissingFields = missingFields.length > 0
    ? missingFields
    : missingMetadata
      ? ['width', 'height', 'userId', 'userName', 'title', 'createdAtPixiv', 'xRestrict']
      : [];

  return {
    batchSize: normalizeBatchSize(record.batch_size ?? record.batchSize),
    yearFrom,
    yearTo,
    userId: toBigInt(record.user_id ?? record.userId),
    includedTags,
    excludedTags,
    missingFields: normalizedMissingFields,
  };
}

function normalizeCursor(cursor: unknown): NormalizedBackfillCursor {
  const record = cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>) : {};
  const last = toBigInt(record.last_illust_id ?? record.lastIllustId);
  return { lastIllustId: last && last > 0n ? last : null };
}

function buildYearRange(yearFrom: number, yearTo: number): { gte: Date; lt: Date } {
  const from = Math.max(1970, Math.min(2500, yearFrom));
  const to = Math.max(from, Math.min(2500, yearTo));
  const gte = new Date(Date.UTC(from, 0, 1));
  const lt = new Date(Date.UTC(to + 1, 0, 1));
  return { gte, lt };
}

function normalizeMissingFieldName(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const key = normalized.toLowerCase();

  if (key === 'width') return 'width';
  if (key === 'height') return 'height';
  if (key === 'user_id' || key === 'userid') return 'userId';
  if (key === 'user_name' || key === 'username') return 'userName';
  if (key === 'title') return 'title';
  if (key === 'created_at_pixiv' || key === 'createdatpixiv') return 'createdAtPixiv';
  if (key === 'x_restrict' || key === 'xrestrict') return 'xRestrict';
  if (key === 'ai_type' || key === 'aitype') return 'aiType';

  return null;
}

function buildMissingFieldsWhere(fields: string[]): Prisma.ImageWhereInput | null {
  if (fields.length === 0) return null;

  const or: Prisma.ImageWhereInput[] = [];
  for (const field of fields) {
    const name = normalizeMissingFieldName(field);
    if (!name) continue;

    if (name === 'width') or.push({ width: null });
    else if (name === 'height') or.push({ height: null });
    else if (name === 'userId') or.push({ userId: null });
    else if (name === 'userName') or.push({ userName: null });
    else if (name === 'title') or.push({ title: null });
    else if (name === 'createdAtPixiv') or.push({ createdAtPixiv: null });
    else if (name === 'xRestrict') or.push({ xRestrict: null });
    else if (name === 'aiType') or.push({ aiType: null });
  }

  if (or.length === 0) return null;
  return { OR: or };
}

function buildBackfillWhere(criteria: NormalizedBackfillCriteria, cursor: NormalizedBackfillCursor): Prisma.ImageWhereInput {
  const and: Prisma.ImageWhereInput[] = [{ status: { not: IMAGE_STATUS_DISABLED } }];

  if (criteria.userId) {
    and.push({ userId: criteria.userId });
  }

  if (criteria.yearFrom !== null && criteria.yearTo !== null) {
    and.push({ createdAtPixiv: buildYearRange(criteria.yearFrom, criteria.yearTo) });
  }

  if (criteria.includedTags.length > 0) {
    and.push({
      imageTags: {
        some: {
          tag: {
            name: { in: criteria.includedTags },
          },
        },
      },
    });
  }

  if (criteria.excludedTags.length > 0) {
    and.push({
      imageTags: {
        none: {
          tag: {
            name: { in: criteria.excludedTags },
          },
        },
      },
    });
  }

  const missingWhere = buildMissingFieldsWhere(criteria.missingFields);
  if (missingWhere) {
    and.push(missingWhere);
  }

  if (cursor.lastIllustId) {
    and.push({ illustId: { gt: cursor.lastIllustId } });
  }

  if (and.length === 1) return and[0]!;
  return { AND: and };
}

async function loadNextIllustIds(criteria: NormalizedBackfillCriteria, cursor: NormalizedBackfillCursor): Promise<bigint[]> {
  const prisma = getPrismaClient();

  const rows = await prisma.image.findMany({
    where: buildBackfillWhere(criteria, cursor),
    select: { illustId: true },
    distinct: ['illustId'],
    orderBy: { illustId: 'asc' },
    take: criteria.batchSize,
  });

  const out: bigint[] = [];
  for (const row of rows) {
    const id = typeof row.illustId === 'bigint' ? row.illustId : BigInt(String(row.illustId));
    if (id > 0n) out.push(id);
  }

  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return out;
}

function formatCursor(cursor: NormalizedBackfillCursor): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (!cursor.lastIllustId) return Prisma.JsonNull;
  return { last_illust_id: cursor.lastIllustId.toString() } as any;
}

export async function enqueueHydrationBackfillRun(runId: bigint, requestId?: string): Promise<string | null> {
  const payload: HydrationBackfillJobData = { run_id: runId.toString() };
  const normalizedRequestId = normalizeRequestId(requestId);
  if (normalizedRequestId) payload.request_id = normalizedRequestId;

  const boss = await ensureQueue(HYDRATION_BACKFILL_JOB);
  const id = await boss.sendThrottled(
    HYDRATION_BACKFILL_JOB,
    payload,
    {},
    2,
    runId.toString(),
  );
  return id ?? null;
}

export async function startHydrationBackfillRun(params: {
  criteria: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  requestedBy?: string | null;
  requestId?: string;
}): Promise<{ run_id: string; job_id: string | null }> {
  const prisma = getPrismaClient();

  const run = await prisma.hydrationRun.create({
    data: {
      type: 'backfill',
      status: 'pending',
      requestedBy: params.requestedBy ?? null,
      criteria: params.criteria ?? Prisma.JsonNull,
      cursor: Prisma.JsonNull,
      processed: 0,
      success: 0,
      failed: 0,
    },
    select: { id: true },
  });

  const jobId = await enqueueHydrationBackfillRun(run.id, params.requestId);
  return { run_id: run.id.toString(), job_id: jobId };
}

async function processBackfillRun(runId: bigint, requestId?: string): Promise<void> {
  const prisma = getPrismaClient();

  const run = await prisma.hydrationRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      type: true,
      status: true,
      criteria: true,
      cursor: true,
      processed: true,
      success: true,
      failed: true,
      startedAt: true,
    },
  });

  if (!run) {
    logger.warn({ run_id: runId.toString() }, 'hydration_backfill: run not found');
    return;
  }

  if (run.type !== 'backfill') {
    logger.warn({ run_id: runId.toString(), type: run.type }, 'hydration_backfill: run type mismatch');
    return;
  }

  if (run.status === 'completed' || run.status === 'canceled') {
    return;
  }

  if (run.status === 'paused') {
    return;
  }

  if (run.status === 'failed') {
    return;
  }

  if (run.status === 'pending') {
    await prisma.hydrationRun.updateMany({
      where: { id: runId, status: 'pending' },
      data: { status: 'running', startedAt: run.startedAt ?? new Date() },
    });
  }

  const criteria = normalizeCriteria(run.criteria);
  let cursor = normalizeCursor(run.cursor);

  for (let batchIndex = 0; batchIndex < MAX_BATCHES_PER_JOB; batchIndex += 1) {
    const nextIllustIds = await loadNextIllustIds(criteria, cursor);
    if (nextIllustIds.length === 0) {
      await prisma.hydrationRun.update({
        where: { id: runId },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          cursor: formatCursor(cursor),
          lastErrorCode: null,
          lastErrorMsg: null,
        },
      });
      return;
    }

    let enqueued = 0;
    let enqueueFailed = 0;
    let firstError: { code: string; message: string } | null = null;

    for (const illustId of nextIllustIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await enqueueHydrateMetadata(illustId, requestId);
        enqueued += 1;
      } catch (err: unknown) {
        enqueueFailed += 1;
        if (!firstError) {
          const code = typeof (err as any)?.code === 'string' ? String((err as any).code) : 'enqueue_failed';
          firstError = { code, message: err instanceof Error ? err.message : String(err) };
        }
      }
    }

    cursor = { lastIllustId: nextIllustIds[nextIllustIds.length - 1] ?? cursor.lastIllustId };

    const errorCode = firstError ? firstError.code : null;
    const errorMsg = firstError ? firstError.message : null;

    await prisma.hydrationRun.update({
      where: { id: runId },
      data: {
        processed: { increment: nextIllustIds.length },
        success: { increment: enqueued },
        failed: { increment: enqueueFailed },
        cursor: formatCursor(cursor),
        lastErrorCode: errorCode,
        lastErrorMsg: errorMsg,
      },
    });

    if (firstError && firstError.code === 'QUEUE_DISABLED') {
      await prisma.hydrationRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          lastErrorCode: firstError.code,
          lastErrorMsg: firstError.message,
        },
      });
      return;
    }
  }

  await enqueueHydrationBackfillRun(runId);
}

export async function registerHydrationBackfillWorker(): Promise<void> {
  await work<HydrationBackfillJobData>(HYDRATION_BACKFILL_JOB, async (jobs) => {
    for (const job of jobs) {
      const jobData: any = job?.data ?? {};
      const runId = toBigInt(jobData.run_id ?? jobData.runId ?? jobData.id);
      if (!runId) {
        const err = new Error('Invalid run_id');
        (err as any).code = 'INVALID_RUN_ID';
        throw err;
      }

      const requestId = normalizeRequestId(jobData.request_id ?? jobData.requestId);

      const startedAt = process.hrtime.bigint();
      try {
        await processBackfillRun(runId, requestId);
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        recordJobSuccess({ job: HYDRATION_BACKFILL_JOB, illustId: undefined, durationSeconds });
        logger.info(
          {
            request_id: requestId,
            job: { name: HYDRATION_BACKFILL_JOB, id: job.id },
            run_id: runId.toString(),
            duration_seconds: durationSeconds,
          },
          'hydration_backfill tick done',
        );
      } catch (err: unknown) {
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        recordJobFail({ job: HYDRATION_BACKFILL_JOB, illustId: undefined, durationSeconds });
        logger.warn(
          {
            request_id: requestId,
            job: { name: HYDRATION_BACKFILL_JOB, id: job.id },
            run_id: runId.toString(),
            duration_seconds: durationSeconds,
            err,
          },
          'hydration_backfill tick failed',
        );
        throw err;
      }
    }
  });
}
