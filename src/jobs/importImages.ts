import logger from '../logger/logger';
import { auditAdminEvent } from '../audit/adminAudit';
import { getEnv } from '../config/env';
import { getEffectiveRuntimeConfig } from '../config/runtimeConfig';
import { getPrismaClient } from '../db/prismaClient';
import { IMAGE_STATUS_DISABLED } from '../repositories/imagesRepo';
import { updateImport } from '../repositories/importsRepo';
import { bulkUpsertImagesForImport, upsertImageForImport } from '../services/import/imageWriteService';
import { enqueueHydrateMetadata } from './hydrateMetadata';
import { enqueue, ensureQueue, startQueue } from '../queue/queue';

const ADMIN_IMAGES_IMPORT_JOB = 'admin_images_import';
const ADMIN_IMPORT_ROLLBACK_JOB = 'admin_import_rollback';

type ImportItem = {
  line: number;
  illust_id: string;
  page_index: number;
  ext: string;
  original_url: string;
};

type AdminImagesImportJobData = {
  import_id: string;
  items: ImportItem[];
  request_id?: string;
  actor?: string;
};

type AdminImportRollbackJobData = {
  import_id: string;
  mode?: 'disable' | 'delete';
  request_id?: string;
  actor?: string;
};

function normalizeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v ? v : undefined;
}

function normalizeActor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v ? v : undefined;
}

function toBigIntId(value: unknown, label: string): bigint {
  try {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
    if (typeof value === 'string' && value.trim()) return BigInt(value.trim());
  } catch {
    // ignore
  }
  throw new Error(`Invalid ${label}`);
}

function buildStableProxyPath(id: bigint, ext: string): string {
  return `/i/${id.toString()}.${ext}`;
}

function buildImportProxyPath(illustId: bigint, pageIndex: number, ext: string): string {
  return `/i/${illustId.toString()}_${pageIndex}.${ext}`;
}

export function getAdminImportQueueNames(): string[] {
  return [ADMIN_IMAGES_IMPORT_JOB, ADMIN_IMPORT_ROLLBACK_JOB];
}

export async function enqueueAdminImagesImport(params: {
  importId: bigint;
  items: ImportItem[];
  requestId?: string;
  actor?: string;
}): Promise<string> {
  const payload: AdminImagesImportJobData = {
    import_id: params.importId.toString(),
    items: params.items,
  };
  const requestId = normalizeRequestId(params.requestId);
  const actor = normalizeActor(params.actor);
  if (requestId) payload.request_id = requestId;
  if (actor) payload.actor = actor;
  return enqueue<AdminImagesImportJobData>(ADMIN_IMAGES_IMPORT_JOB, payload);
}

export async function enqueueAdminImportRollback(params: {
  importId: bigint;
  mode?: 'disable' | 'delete';
  requestId?: string;
  actor?: string;
}): Promise<string> {
  const payload: AdminImportRollbackJobData = { import_id: params.importId.toString() };
  const mode = params.mode === 'delete' ? 'delete' : 'disable';
  payload.mode = mode;
  const requestId = normalizeRequestId(params.requestId);
  const actor = normalizeActor(params.actor);
  if (requestId) payload.request_id = requestId;
  if (actor) payload.actor = actor;
  return enqueue<AdminImportRollbackJobData>(ADMIN_IMPORT_ROLLBACK_JOB, payload);
}

export async function processAdminImagesImport(params: {
  importId: bigint;
  items: ImportItem[];
  requestId?: string;
  actor?: string;
  jobId?: string;
}): Promise<{
  ok: boolean;
  import_id: string;
  success: number;
  failed: number;
  enqueued_hydrate_metadata: number;
  note: string;
}> {
  const prisma = getPrismaClient();
  const env = getEnv();

  const bulkMin = Math.max(0, Math.trunc(env.ADMIN_IMPORT_BULK_MIN_IMAGES || 0));
  const useBulk = bulkMin > 0 && params.items.length >= bulkMin;

  const errors: Array<{ line: number; url: string; code: string; message: string }> = [];
  const MAX_ERRORS = 50;

  let success = 0;
  let failed = 0;

  const illustIdsToHydrate = new Set<string>();

  if (useBulk) {
    const rows = params.items.map((item) => ({
      illustId: BigInt(item.illust_id),
      pageIndex: item.page_index,
      ext: item.ext,
      originalUrl: item.original_url,
      proxyPath: buildImportProxyPath(BigInt(item.illust_id), item.page_index, item.ext),
    }));

    try {
      await bulkUpsertImagesForImport(rows, { createdImportId: params.importId });
      success = params.items.length;
      for (const item of params.items) {
        illustIdsToHydrate.add(item.illust_id);
      }
    } catch (err: unknown) {
      failed = params.items.length;
      const message = err instanceof Error ? err.message : String(err);
      for (const item of params.items.slice(0, MAX_ERRORS)) {
        errors.push({ line: item.line, url: item.original_url, code: 'bulk_upsert_failed', message });
      }
    }
  } else {
    for (const item of params.items) {
      const illustId = BigInt(item.illust_id);
      const provisionalProxyPath = `/i/pending.${item.ext}`;

      try {
        const image = await upsertImageForImport({
          illustId,
          pageIndex: item.page_index,
          ext: item.ext,
          originalUrl: item.original_url,
          proxyPath: provisionalProxyPath,
          createdImportId: params.importId,
        });

        const stableProxyPath = buildStableProxyPath(image.id, item.ext);
        if (image.proxyPath !== stableProxyPath) {
          await prisma.image.update({ where: { id: image.id }, data: { proxyPath: stableProxyPath } });
        }

        success += 1;
        illustIdsToHydrate.add(item.illust_id);
      } catch (err: unknown) {
        failed += 1;
        if (errors.length < MAX_ERRORS) {
          errors.push({
            line: item.line,
            url: item.original_url,
            code: 'upsert_failed',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  let enqueuedHydrateMetadata = 0;
  let enqueueNote = 'ok';

  try {
    const runtimeConfig = await getEffectiveRuntimeConfig({ prisma });
    const maxHydrateIllusts = Math.max(0, Math.trunc(runtimeConfig.adminImportMaxHydrateIllusts || 0));

    if (!runtimeConfig.hydrateOnImport) {
      enqueueNote = 'skipped:policy_disabled';
    } else if (maxHydrateIllusts > 0 && illustIdsToHydrate.size > maxHydrateIllusts) {
      enqueueNote = `skipped:too_many_illusts:${illustIdsToHydrate.size}`;
    } else {
      for (const rawIllustId of illustIdsToHydrate) {
        // eslint-disable-next-line no-await-in-loop
        await enqueueHydrateMetadata(BigInt(rawIllustId), params.requestId);
        enqueuedHydrateMetadata += 1;
      }
    }
  } catch (err: unknown) {
    const code = typeof (err as any)?.code === 'string' ? (err as any).code : '';
    const message = err instanceof Error ? err.message : String(err);
    enqueueNote = code ? `enqueue_failed:${code}:${message}` : `enqueue_failed:${message}`;
  }

  const record = await prisma.import.findUnique({ where: { id: params.importId } });
  const previousSuccess = Number(record?.success ?? 0);
  const previousFailed = Number(record?.failed ?? 0);
  const detail = (record?.detail && typeof record.detail === 'object') ? (record.detail as any) : {};

  const mergedErrors = Array.isArray(detail.errors) ? detail.errors.slice(0, MAX_ERRORS) : [];
  for (const e of errors) {
    if (mergedErrors.length >= MAX_ERRORS) break;
    mergedErrors.push(e);
  }

  const nextDetail: any = {
    ...detail,
    errors: mergedErrors,
    job: { ...(detail.job ?? {}), last_job_id: params.jobId ?? null },
    enqueued: {
      hydrate_metadata: enqueuedHydrateMetadata,
      note: enqueueNote,
      unique_illusts: illustIdsToHydrate.size,
    },
  };

  await updateImport({
    id: params.importId,
    success: previousSuccess + success,
    failed: previousFailed + failed,
    detail: nextDetail,
  });

  void auditAdminEvent({
    actor: params.actor ?? 'admin_token',
    action: 'images_import_job_done',
    resource: 'Import',
    record_id: params.importId.toString(),
    request_id: params.requestId,
    detail: {
      ok: true,
      job_id: params.jobId ?? null,
      success,
      failed,
      enqueued: {
        hydrate_metadata: enqueuedHydrateMetadata,
        note: enqueueNote,
        unique_illusts: illustIdsToHydrate.size,
      },
    },
  });

  return {
    ok: true,
    import_id: params.importId.toString(),
    success,
    failed,
    enqueued_hydrate_metadata: enqueuedHydrateMetadata,
    note: enqueueNote,
  };
}

export async function processAdminImportRollback(params: {
  importId: bigint;
  mode: 'disable' | 'delete';
  requestId?: string;
  actor?: string;
  jobId?: string;
}): Promise<{ ok: boolean; import_id: string; mode: 'disable' | 'delete'; affected: number }> {
  const prisma = getPrismaClient();

  let affected = 0;
  if (params.mode === 'delete') {
    const res = await prisma.image.deleteMany({ where: { createdImportId: params.importId } });
    affected = Number(res?.count ?? 0);
  } else {
    const res = await prisma.image.updateMany({
      where: { createdImportId: params.importId },
      data: { status: IMAGE_STATUS_DISABLED },
    });
    affected = Number(res?.count ?? 0);
  }

  const record = await prisma.import.findUnique({ where: { id: params.importId } });
  const detail = (record?.detail && typeof record.detail === 'object') ? (record.detail as any) : {};
  const nextDetail: any = {
    ...detail,
    rollback: {
      at: new Date().toISOString(),
      mode: params.mode,
      affected,
      job_id: params.jobId ?? null,
    },
  };

  await updateImport({
    id: params.importId,
    detail: nextDetail,
  });

  void auditAdminEvent({
    actor: params.actor ?? 'admin_token',
    action: 'images_import_rollback',
    resource: 'Import',
    record_id: params.importId.toString(),
    request_id: params.requestId,
    detail: {
      ok: true,
      job_id: params.jobId ?? null,
      mode: params.mode,
      affected,
    },
  });

  return { ok: true, import_id: params.importId.toString(), mode: params.mode, affected };
}

export async function registerAdminImportWorker(): Promise<void> {
  const boss = await startQueue();
  if (!boss) return;

  await Promise.all([
    ensureQueue(ADMIN_IMAGES_IMPORT_JOB),
    ensureQueue(ADMIN_IMPORT_ROLLBACK_JOB),
  ]);

  // pg-boss v12 passes `jobs[]` to the handler (even when batchSize=1).
  // Use batchSize=1 so each Import runs independently and remains debuggable.
  await boss.work(
    ADMIN_IMAGES_IMPORT_JOB,
    { batchSize: 1 },
    async (jobs: any[]) => adminImportWorkerHandlers.handleAdminImagesImportJobs(jobs),
  );
  await boss.work(
    ADMIN_IMPORT_ROLLBACK_JOB,
    { batchSize: 1 },
    async (jobs: any[]) => adminImportWorkerHandlers.handleAdminImportRollbackJobs(jobs),
  );
}

export async function handleAdminImagesImportJobs(jobs: any[]): Promise<any> {
  const batch = Array.isArray(jobs) ? jobs : [];
  let lastResult: any = undefined;

  for (const job of batch) {
    const jobData: any = job?.data ?? {};
    const importId = toBigIntId(jobData.import_id ?? jobData.importId ?? jobData.id, 'import_id');
    const requestId = normalizeRequestId(jobData.request_id ?? jobData.requestId);
    const actor = normalizeActor(jobData.actor);
    const items = Array.isArray(jobData.items) ? (jobData.items as ImportItem[]) : [];

    if (items.length === 0) {
      throw new Error('import items is empty');
    }

    const startedAt = process.hrtime.bigint();
    const result = await processAdminImagesImport({
      importId,
      items,
      requestId,
      actor,
      jobId: job?.id,
    });
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

    logger.info(
      {
        request_id: requestId,
        job: { name: ADMIN_IMAGES_IMPORT_JOB, id: job?.id ?? null },
        import_id: result.import_id,
        success: result.success,
        failed: result.failed,
        enqueued_hydrate_metadata: result.enqueued_hydrate_metadata,
        duration_seconds: durationSeconds,
      },
      'admin_images_import done',
    );

    lastResult = result;
  }

  return batch.length === 1 ? lastResult : undefined;
}

export async function handleAdminImportRollbackJobs(jobs: any[]): Promise<any> {
  const batch = Array.isArray(jobs) ? jobs : [];
  let lastResult: any = undefined;

  for (const job of batch) {
    const jobData: any = job?.data ?? {};
    const importId = toBigIntId(jobData.import_id ?? jobData.importId ?? jobData.id, 'import_id');
    const requestId = normalizeRequestId(jobData.request_id ?? jobData.requestId);
    const actor = normalizeActor(jobData.actor);
    const mode = jobData.mode === 'delete' ? 'delete' : 'disable';

    const startedAt = process.hrtime.bigint();
    const result = await processAdminImportRollback({
      importId,
      mode,
      requestId,
      actor,
      jobId: job?.id,
    });
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

    logger.info(
      {
        request_id: requestId,
        job: { name: ADMIN_IMPORT_ROLLBACK_JOB, id: job?.id ?? null },
        import_id: result.import_id,
        mode: result.mode,
        affected: result.affected,
        duration_seconds: durationSeconds,
      },
      'admin_import_rollback done',
    );

    lastResult = result;
  }

  return batch.length === 1 ? lastResult : undefined;
}

export const adminImportWorkerHandlers = {
  handleAdminImagesImportJobs,
  handleAdminImportRollbackJobs,
};
