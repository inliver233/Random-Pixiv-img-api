import { Router } from 'express';
import fs from 'node:fs/promises';

import { getEnv } from '../config/env';
import { ensureQueue, getQueueHealth } from '../queue/queue';
import { parsePixivUrl } from '../utils/parsePixivUrl';
import { createImport, getById as getImportById, updateImport } from '../repositories/importsRepo';
import { auditAdminEvent } from '../audit/adminAudit';
import { enqueueAdminImagesImport, enqueueAdminImportRollback } from '../jobs/importImages';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const formidable = require('express-formidable') as (options?: any) => any;

function parseAllowedMimeTypes(value: string): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');
}

function validateUploadFileType(file: any): void {
  if (!file) return;

  const env = getEnv();
  const allowed = parseAllowedMimeTypes(env.ADMIN_IMPORT_ALLOWED_MIME_TYPES);
  if (allowed.length === 0) return;

  const mime = String(file.type || '').trim().toLowerCase();
  if (!mime) return;

  if (!allowed.includes(mime)) {
    const err = new Error(`Invalid upload type: ${mime}`);
    (err as any).status = 400;
    (err as any).code = 'INVALID_UPLOAD_TYPE';
    throw err;
  }
}

function adminImportUploadMiddleware(req: any, res: any, next: any): void {
  const env = getEnv();

  const mw = formidable({
    multiples: false,
    maxFileSize: env.ADMIN_IMPORT_MAX_FILE_BYTES,
    maxFieldsSize: env.ADMIN_IMPORT_MAX_FILE_BYTES,
  });

  mw(req, res, (err: any) => {
    if (!err) {
      next();
      return;
    }

    const httpCode = Number(err?.httpCode);
    const code = typeof err?.code === 'string' ? err.code : '';
    const message = typeof err?.message === 'string' ? err.message : '';

    const tooLarge = code === 'ETOOBIG'
      || code === 'LIMIT_FILE_SIZE'
      || httpCode === 413
      || /maxfilesize|maxfieldssize|payload too large|too large|exceeded/i.test(message);

    if (tooLarge) {
      err.status = 413;
      err.code = 'PAYLOAD_TOO_LARGE';
    }

    next(err);
  });
}

type ImportOkRow = {
  ok: true;
  illust_id: string;
  page_index: number;
  image_id: string | null;
  ext: string;
  original_url: string;
  proxy_path: string | null;
};

type ImportErrorRow = {
  ok: false;
  line: number;
  url: string;
  code: string;
  message: string;
};

type ImportResponse = {
  ok: true;
  import_id: string | null;
  queued?: boolean;
  job_id?: string | null;
  dry_run: boolean;
  preview?: Array<Pick<ImportOkRow, 'illust_id' | 'page_index' | 'ext' | 'original_url'>>;
  error_export?: {
    total_errors: number;
    exported_errors: number;
    truncated: boolean;
    urls_text: string;
    urls_with_comments_text: string;
  };
  total_lines: number;
  unique_images: number;
  deduped: number;
  accepted: number;
  success: number;
  failed: number;
  enqueued: {
    hydrate_metadata: number;
    note: string;
  };
  results: ImportOkRow[];
  errors: ImportErrorRow[];
};

function normalizeText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value);
}

function parseBooleanFlag(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;

  const raw = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return false;

  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function readLines(text: string): Array<{ line: number; url: string }> {
  const rawLines = String(text || '').split(/\r?\n/);
  const out: Array<{ line: number; url: string }> = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const url = rawLines[i]?.trim() ?? '';
    if (!url) continue;
    if (url.startsWith('#')) continue;
    out.push({ line: i + 1, url });
  }
  return out;
}

async function readUploadFileText(file: any): Promise<string> {
  if (!file) return '';
  const filePath = typeof file.path === 'string' ? file.path : '';
  if (!filePath) return '';
  return fs.readFile(filePath, 'utf8');
}

const router = Router();

function parsePositiveBigInt(value: unknown): bigint | null {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

router.get('/imports/:id', (req, res, next) => {
  (async () => {
    res.setHeader('Cache-Control', 'no-store');

    const id = parsePositiveBigInt((req.params as any).id);
    if (!id) {
      const err = new Error('Invalid import id.');
      (err as any).status = 400;
      throw err;
    }

    const record = await getImportById(id);
    if (!record) {
      const err = new Error('Import not found.');
      (err as any).status = 404;
      (err as any).code = 'IMPORT_NOT_FOUND';
      throw err;
    }

    const total = Number(record.total ?? 0);
    const success = Number(record.success ?? 0);
    const failed = Number(record.failed ?? 0);
    const detailObj = record.detail && typeof record.detail === 'object' ? (record.detail as any) : null;
    const deduped = detailObj && Number.isFinite(Number(detailObj?.deduped)) ? Math.max(0, Math.trunc(Number(detailObj.deduped))) : 0;
    const processed = success + failed + deduped;
    const remaining = Math.max(0, total - processed);
    const done = total > 0 ? processed >= total : false;

    const queue = await getQueueHealth();

    res.status(200).json({
      ok: true,
      import: {
        id: record.id.toString(),
        created_at: record.createdAt ? record.createdAt.toISOString() : null,
        source: record.source ?? null,
        total,
        success,
        failed,
        detail: record.detail ?? null,
      },
      progress: {
        total,
        processed,
        deduped,
        remaining,
        done,
      },
      queue,
    });
  })().catch(next);
});

router.post('/imports/:id/rollback', (req, res, next) => {
  (async () => {
    res.setHeader('Cache-Control', 'no-store');

    const id = parsePositiveBigInt((req.params as any).id);
    if (!id) {
      const err = new Error('Invalid import id.');
      (err as any).status = 400;
      throw err;
    }

    const record = await getImportById(id);
    if (!record) {
      const err = new Error('Import not found.');
      (err as any).status = 404;
      (err as any).code = 'IMPORT_NOT_FOUND';
      throw err;
    }

    const modeRaw = normalizeText((req.body as any)?.mode ?? (req.query as any)?.mode);
    const normalizedMode = modeRaw.trim().toLowerCase();
    const mode = normalizedMode === 'delete' ? 'delete' : 'disable';

    const requestIdRaw = (req as any).request_id;
    const requestId = typeof requestIdRaw === 'string' && requestIdRaw.trim() ? requestIdRaw.trim() : undefined;
    const actorRaw = (req as any)?.session?.admin_user;
    const actor = typeof actorRaw === 'string' && actorRaw.trim() ? actorRaw.trim() : 'admin_token';

    const jobId = await enqueueAdminImportRollback({
      importId: id,
      mode,
      requestId,
      actor,
    });

    const detailObj = record.detail && typeof record.detail === 'object' ? (record.detail as any) : {};
    await updateImport({
      id,
      detail: {
        ...detailObj,
        rollback_enqueued: {
          at: new Date().toISOString(),
          mode,
          job_id: jobId,
        },
      },
    });

    void auditAdminEvent({
      actor,
      action: 'images_import_rollback_enqueued',
      resource: 'Import',
      record_id: id.toString(),
      request_id: requestId,
      ip: (req as any)?.ip,
      user_agent: (req as any)?.headers?.['user-agent'],
      detail: { mode, job_id: jobId },
    });

    res.status(200).json({ ok: true, import_id: id.toString(), mode, job_id: jobId });
  })().catch(next);
});

router.post(
  '/images/import',
  adminImportUploadMiddleware,
  (req, res, next) => {
    (async () => {
      const fields = (req as any).fields || {};
      const files = (req as any).files || {};
      const env = getEnv();
      const preview = parseBooleanFlag(fields.preview ?? fields.Preview ?? (req.query as any)?.preview ?? (req.query as any)?.Preview);
      const dryRun = preview
        || parseBooleanFlag(fields.dry_run ?? fields.dryRun ?? (req.query as any)?.dry_run ?? (req.query as any)?.dryRun);

      const textarea =
        normalizeText(fields.urls)
        || normalizeText(fields.text)
        || normalizeText(fields.textarea)
        || normalizeText(fields.input);

      const uploadFile = files.file || files.upload || files.urls;
      validateUploadFileType(uploadFile);
      const fileText = await readUploadFileText(uploadFile);

      const combined = [textarea, fileText].filter((v) => v && v.trim()).join('\n');
      const lines = readLines(combined);

      if (lines.length === 0) {
        const err = new Error('No URLs provided.');
        (err as any).status = 400;
        (err as any).code = 'EMPTY_INPUT';
        throw err;
      }

      if (env.ADMIN_IMPORT_MAX_LINES > 0 && lines.length > env.ADMIN_IMPORT_MAX_LINES) {
        const err = new Error(
          `Too many lines: ${lines.length}. Max is ${env.ADMIN_IMPORT_MAX_LINES}. `
          + `Please split the input into multiple requests (<= ${env.ADMIN_IMPORT_MAX_LINES} lines each).`,
        );
        (err as any).status = 400;
        (err as any).code = 'MAX_LINES_EXCEEDED';
        throw err;
      }

      const errors: ImportErrorRow[] = [];
      const results: ImportOkRow[] = [];

      const MAX_RESULTS = 200;
      const MAX_ERRORS = 2000;

      const dedup = new Set<string>();
      let deduped = 0;
      const illustIdsToHydrate = new Set<string>();
      let parseFailedCount = 0;

      const parsedOk: Array<{
        line: number;
        illustId: bigint;
        pageIndex: number;
        ext: string;
        originalUrl: string;
      }> = [];

      const plannedItems: Array<{
        line: number;
        illust_id: string;
        page_index: number;
        ext: string;
        original_url: string;
      }> = [];

      for (const item of lines) {
        const parsed = parsePixivUrl(item.url);
        if (!parsed.ok) {
          parseFailedCount += 1;
          if (errors.length < MAX_ERRORS) {
            errors.push({
              ok: false,
              line: item.line,
              url: item.url,
              code: parsed.code,
              message: parsed.message,
            });
          }
          continue;
        }

        const key = `${parsed.illustId.toString()}:${parsed.pageIndex}`;
        if (dedup.has(key)) {
          deduped += 1;
          continue;
        }
        dedup.add(key);

        parsedOk.push({
          line: item.line,
          illustId: parsed.illustId,
          pageIndex: parsed.pageIndex,
          ext: parsed.ext,
          originalUrl: item.url,
        });

        plannedItems.push({
          line: item.line,
          illust_id: parsed.illustId.toString(),
          page_index: parsed.pageIndex,
          ext: parsed.ext,
          original_url: item.url,
        });

        illustIdsToHydrate.add(parsed.illustId.toString());
      }

      const totalLines = lines.length;

      const accepted = parsedOk.length;
      const success = dryRun ? accepted : 0;
      const failed = parseFailedCount;

      const maxExportErrors = 1000;
      const exportErrors = errors.slice(0, maxExportErrors);
      const errorExport = {
        total_errors: failed,
        exported_errors: exportErrors.length,
        truncated: failed > maxExportErrors,
        urls_text: exportErrors.map((row) => row.url).join('\n'),
        urls_with_comments_text: exportErrors
          .map((row) => `# line ${row.line} code=${row.code}\n${row.url}`)
          .join('\n'),
      };

      const requestIdRaw = (req as any).request_id;
      const requestId = typeof requestIdRaw === 'string' && requestIdRaw.trim() ? requestIdRaw.trim() : undefined;
      const actorRaw = (req as any)?.session?.admin_user;
      const actor = typeof actorRaw === 'string' && actorRaw.trim() ? actorRaw.trim() : 'admin_token';

      if (dryRun) {
        for (const row of parsedOk.slice(0, MAX_RESULTS)) {
          results.push({
            ok: true,
            illust_id: row.illustId.toString(),
            page_index: row.pageIndex,
            image_id: null,
            ext: row.ext,
            original_url: row.originalUrl,
            proxy_path: null,
          });
        }

        const response: ImportResponse = {
          ok: true,
          import_id: null,
          dry_run: true,
          preview: preview
            ? results.map((row) => ({
              illust_id: row.illust_id,
              page_index: row.page_index,
              ext: row.ext,
              original_url: row.original_url,
            }))
            : undefined,
          error_export: errorExport,
        total_lines: totalLines,
        unique_images: dedup.size,
        deduped,
        accepted,
        success,
        failed,
        enqueued: {
          hydrate_metadata: 0,
          note: 'dry_run',
          },
          results,
          errors,
        };

        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(response);
        return;
      }

      const detailBase: any = {
        deduped,
        unique: dedup.size,
        errors: errors.slice(0, 50),
        error_export: {
          total_errors: errorExport.total_errors,
          exported_errors: errorExport.exported_errors,
          truncated: errorExport.truncated,
        },
        planned: {
          unique_images: dedup.size,
          unique_illusts: illustIdsToHydrate.size,
        },
      };

      const importRecord = await createImport({
        total: totalLines,
        createdBy: actor,
        source: 'admin_api',
        success: 0,
        failed,
        detail: detailBase,
      });

      let jobId: string | null = null;
      let enqueueNote = 'skipped:no_valid_images';
      if (plannedItems.length > 0) {
        try {
          jobId = await enqueueAdminImagesImport({
            importId: importRecord.id,
            items: plannedItems,
            requestId,
            actor,
          });
          enqueueNote = 'queued';
        } catch (err: unknown) {
          const code = typeof (err as any)?.code === 'string' ? (err as any).code : 'IMPORT_ENQUEUE_FAILED';
          const message = err instanceof Error ? err.message : String(err);
          const nextDetail: any = {
            ...detailBase,
            job: { enqueued_job_id: null, enqueue_error: { code, message } },
          };
          await updateImport({ id: importRecord.id, detail: nextDetail });
          const httpErr = new Error(message);
          (httpErr as any).status = code === 'QUEUE_DISABLED' ? 503 : 500;
          (httpErr as any).code = code;
          (httpErr as any).import_id = importRecord.id.toString();
          throw httpErr;
        }
      }

      const nextDetail: any = {
        ...detailBase,
        job: { enqueued_job_id: jobId },
        enqueued: {
          hydrate_metadata: 0,
          note: enqueueNote,
          unique_illusts: illustIdsToHydrate.size,
        },
      };
      await updateImport({ id: importRecord.id, detail: nextDetail });

      void auditAdminEvent({
        actor,
        action: 'images_import_enqueued',
        resource: 'Import',
        record_id: importRecord.id.toString(),
        request_id: (req as any)?.request_id,
        ip: (req as any)?.ip,
        user_agent: (req as any)?.headers?.['user-agent'],
        detail: {
          job_id: jobId,
          total_lines: totalLines,
          unique_images: dedup.size,
          deduped,
          parse_failed: failed,
          planned: {
            unique_images: dedup.size,
            unique_illusts: illustIdsToHydrate.size,
          },
        },
      });

      const response: ImportResponse = {
        ok: true,
        import_id: importRecord.id.toString(),
        job_id: jobId,
        queued: Boolean(jobId),
        dry_run: false,
        error_export: errorExport,
        total_lines: totalLines,
        unique_images: dedup.size,
        deduped,
        accepted,
        success: 0,
        failed,
        enqueued: {
          hydrate_metadata: 0,
          note: enqueueNote,
        },
        results: [],
        errors,
      };

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(response);
    })().catch(next);
  },
);

type HydrateEnqueueResponse = {
  ok: true;
  hydrate_only: true;
  total_lines: number;
  unique_illusts: number;
  enqueued: {
    hydrate_metadata: number;
    note: string;
  };
  failed: number;
  error_export?: {
    total_errors: number;
    exported_errors: number;
    truncated: boolean;
    urls_text: string;
    urls_with_comments_text: string;
  };
  errors: ImportErrorRow[];
};

router.post(
  '/images/hydrate',
  adminImportUploadMiddleware,
  (req, res, next) => {
    (async () => {
      const fields = (req as any).fields || {};
      const files = (req as any).files || {};
      const env = getEnv();

      const textarea =
        normalizeText(fields.urls)
        || normalizeText(fields.text)
        || normalizeText(fields.textarea)
        || normalizeText(fields.input);

      const uploadFile = files.file || files.upload || files.urls;
      validateUploadFileType(uploadFile);
      const fileText = await readUploadFileText(uploadFile);

      const combined = [textarea, fileText].filter((v) => v && v.trim()).join('\n');
      const lines = readLines(combined);

      if (lines.length === 0) {
        const err = new Error('No URLs provided.');
        (err as any).status = 400;
        (err as any).code = 'EMPTY_INPUT';
        throw err;
      }

      if (env.ADMIN_IMPORT_MAX_LINES > 0 && lines.length > env.ADMIN_IMPORT_MAX_LINES) {
        const err = new Error(
          `Too many lines: ${lines.length}. Max is ${env.ADMIN_IMPORT_MAX_LINES}. `
          + `Please split the input into multiple requests (<= ${env.ADMIN_IMPORT_MAX_LINES} lines each).`,
        );
        (err as any).status = 400;
        (err as any).code = 'MAX_LINES_EXCEEDED';
        throw err;
      }

      const errors: ImportErrorRow[] = [];
      const MAX_ERRORS = 2000;

      const illustIdsToHydrate = new Set<string>();

      for (const item of lines) {
        const parsed = parsePixivUrl(item.url);
        if (!parsed.ok) {
          if (errors.length < MAX_ERRORS) {
            errors.push({
              ok: false,
              line: item.line,
              url: item.url,
              code: parsed.code,
              message: parsed.message,
            });
          }
          continue;
        }

        illustIdsToHydrate.add(parsed.illustId.toString());
      }

      const failed = errors.length;

      const maxExportErrors = 1000;
      const exportErrors = errors.slice(0, maxExportErrors);
      const errorExport = {
        total_errors: failed,
        exported_errors: exportErrors.length,
        truncated: failed > maxExportErrors,
        urls_text: exportErrors.map((row) => row.url).join('\n'),
        urls_with_comments_text: exportErrors
          .map((row) => `# line ${row.line} code=${row.code}\n${row.url}`)
          .join('\n'),
      };

      let enqueuedHydrateMetadata = 0;
      let enqueueNote = 'ok';
      const requestIdRaw = (req as any).request_id;
      const requestId = typeof requestIdRaw === 'string' && requestIdRaw.trim() ? requestIdRaw.trim() : undefined;

      if (illustIdsToHydrate.size === 0) {
        enqueueNote = 'skipped:no_valid_illusts';
      } else {
        try {
          const boss = await ensureQueue('hydrate_metadata');
          for (const rawIllustId of illustIdsToHydrate) {
            const payload: any = { illust_id: rawIllustId };
            if (requestId) payload.request_id = requestId;
            // eslint-disable-next-line no-await-in-loop
            const id = await boss.send('hydrate_metadata', payload);
            if (!id) continue;
            enqueuedHydrateMetadata += 1;
          }
        } catch (err: unknown) {
          const code = typeof (err as any)?.code === 'string' ? (err as any).code : '';
          const message = err instanceof Error ? err.message : String(err);
          enqueueNote = code ? `enqueue_failed:${code}:${message}` : `enqueue_failed:${message}`;
        }
      }

      void auditAdminEvent({
        actor: 'admin_token',
        action: 'hydrate_metadata_enqueue',
        resource: 'HydrationRun',
        request_id: (req as any)?.request_id,
        ip: (req as any)?.ip,
        user_agent: (req as any)?.headers?.['user-agent'],
        detail: {
          total_lines: lines.length,
          unique_illusts: illustIdsToHydrate.size,
          enqueued: {
            hydrate_metadata: enqueuedHydrateMetadata,
            note: enqueueNote,
          },
          failed,
        },
      });

      const response: HydrateEnqueueResponse = {
        ok: true,
        hydrate_only: true,
        total_lines: lines.length,
        unique_illusts: illustIdsToHydrate.size,
        enqueued: {
          hydrate_metadata: enqueuedHydrateMetadata,
          note: enqueueNote,
        },
        failed,
        error_export: errorExport,
        errors,
      };

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(response);
    })().catch(next);
  },
);

export default router;
