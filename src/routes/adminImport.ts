import { Router } from 'express';
import fs from 'node:fs/promises';

import { getEnv } from '../config/env';
import { getPrismaClient } from '../db/prismaClient';
import { enqueueHydrateMetadata } from '../jobs/hydrateMetadata';
import { ensureQueue, getQueueHealth } from '../queue/queue';
import { parsePixivUrl } from '../utils/parsePixivUrl';
import { bulkUpsertImagesForImport, upsertImageForImport } from '../services/import/imageWriteService';
import { createImport, getById as getImportById } from '../repositories/importsRepo';
import { auditAdminEvent } from '../audit/adminAudit';

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

function buildStableProxyPath(id: bigint, ext: string): string {
  return `/i/${id.toString()}.${ext}`;
}

function buildImportProxyPath(illustId: bigint, pageIndex: number, ext: string): string {
  return `/i/${illustId.toString()}_${pageIndex}.${ext}`;
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
    const processed = success + failed;
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
        remaining,
        done,
      },
      queue,
    });
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
      const BULK_BATCH_SIZE = 5000;

      const dedup = new Set<string>();
      let deduped = 0;
      const illustIdsToHydrate = new Set<string>();
      let failedCount = 0;

      const prisma = dryRun ? null : getPrismaClient();

      const parsedOk: Array<{
        line: number;
        illustId: bigint;
        pageIndex: number;
        ext: string;
        originalUrl: string;
      }> = [];

      for (const item of lines) {
        const parsed = parsePixivUrl(item.url);
        if (!parsed.ok) {
          failedCount += 1;
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
      }

      const totalLines = lines.length;

      const bulkMin = Math.max(0, Math.trunc(env.ADMIN_IMPORT_BULK_MIN_IMAGES || 0));
      const useBulk = !dryRun && bulkMin > 0 && parsedOk.length >= bulkMin;

      let success = 0;

      if (dryRun) {
        success = parsedOk.length;
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
      } else if (useBulk) {
        for (let offset = 0; offset < parsedOk.length; offset += BULK_BATCH_SIZE) {
          const chunk = parsedOk.slice(offset, offset + BULK_BATCH_SIZE).map((row) => ({
            illustId: row.illustId,
            pageIndex: row.pageIndex,
            ext: row.ext,
            originalUrl: row.originalUrl,
            proxyPath: buildImportProxyPath(row.illustId, row.pageIndex, row.ext),
          }));
          // eslint-disable-next-line no-await-in-loop
          await bulkUpsertImagesForImport(chunk);
        }

        success = parsedOk.length;
        for (const row of parsedOk) {
          illustIdsToHydrate.add(row.illustId.toString());
        }
      } else {
        for (const row of parsedOk) {
          const provisionalProxyPath = `/i/pending.${row.ext}`;

          try {
            const image = await upsertImageForImport({
              illustId: row.illustId,
              pageIndex: row.pageIndex,
              ext: row.ext,
              originalUrl: row.originalUrl,
              proxyPath: provisionalProxyPath,
            });

            const stableProxyPath = buildStableProxyPath(image.id, row.ext);
            if (image.proxyPath !== stableProxyPath && prisma) {
              await prisma.image.update({ where: { id: image.id }, data: { proxyPath: stableProxyPath } });
            }

            if (results.length < MAX_RESULTS) {
              results.push({
                ok: true,
                illust_id: row.illustId.toString(),
                page_index: row.pageIndex,
                image_id: image.id.toString(),
                ext: row.ext,
                original_url: row.originalUrl,
                proxy_path: stableProxyPath,
              });
            }

            success += 1;
            illustIdsToHydrate.add(row.illustId.toString());
          } catch (err: unknown) {
            failedCount += 1;
            if (errors.length < MAX_ERRORS) {
              errors.push({
                ok: false,
                line: row.line,
                url: row.originalUrl,
                code: 'upsert_failed',
                message: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }

      const failed = failedCount;

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
      let enqueueNote = dryRun ? 'dry_run: queue not enqueued' : 'ok';
      const requestIdRaw = (req as any).request_id;
      const requestId = typeof requestIdRaw === 'string' && requestIdRaw.trim() ? requestIdRaw.trim() : undefined;

      if (!dryRun && illustIdsToHydrate.size > 0) {
        const maxHydrateIllusts = Math.max(0, Math.trunc(env.ADMIN_IMPORT_MAX_HYDRATE_ILLUSTS || 0));
        if (maxHydrateIllusts > 0 && illustIdsToHydrate.size > maxHydrateIllusts) {
          enqueueNote = `skipped:too_many_illusts:${illustIdsToHydrate.size}`;
        } else if (useBulk) {
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
        } else {
        try {
          for (const rawIllustId of illustIdsToHydrate) {
            if (requestId) {
              await enqueueHydrateMetadata(BigInt(rawIllustId), requestId);
            } else {
              await enqueueHydrateMetadata(BigInt(rawIllustId));
            }
            enqueuedHydrateMetadata += 1;
          }
        } catch (err: unknown) {
          const code = typeof (err as any)?.code === 'string' ? (err as any).code : '';
          const message = err instanceof Error ? err.message : String(err);
          enqueueNote = code ? `enqueue_failed:${code}:${message}` : `enqueue_failed:${message}`;
        }
        }
      }

      const importRecord = dryRun
        ? null
        : await createImport({
          total: totalLines,
          source: 'admin_api',
          success,
          failed,
          detail: {
            deduped,
            unique: dedup.size,
            errors: errors.slice(0, 50),
            error_export: {
              total_errors: errorExport.total_errors,
              exported_errors: errorExport.exported_errors,
              truncated: errorExport.truncated,
            },
            enqueued: {
              hydrate_metadata: enqueuedHydrateMetadata,
              note: enqueueNote,
              unique_illusts: illustIdsToHydrate.size,
            },
          },
        });

      if (!dryRun && importRecord) {
        void auditAdminEvent({
          actor: 'admin_token',
          action: 'images_import',
          resource: 'Import',
          record_id: importRecord.id.toString(),
          request_id: (req as any)?.request_id,
          ip: (req as any)?.ip,
          user_agent: (req as any)?.headers?.['user-agent'],
          detail: {
            total_lines: totalLines,
            unique_images: dedup.size,
            deduped,
            success,
            failed,
            enqueued: {
              hydrate_metadata: enqueuedHydrateMetadata,
              note: enqueueNote,
              unique_illusts: illustIdsToHydrate.size,
            },
          },
        });
      }

      const response: ImportResponse = {
        ok: true,
        import_id: importRecord ? importRecord.id.toString() : null,
        dry_run: dryRun,
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
        success,
        failed,
        enqueued: {
          hydrate_metadata: enqueuedHydrateMetadata,
          note: enqueueNote,
        },
        results,
        errors,
      };

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(response);
    })().catch(next);
  },
);

export default router;
