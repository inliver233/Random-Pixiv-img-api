import { Router } from 'express';
import fs from 'node:fs/promises';

import { getEnv } from '../config/env';
import { getPrismaClient } from '../db/prismaClient';
import { parsePixivUrl } from '../utils/parsePixivUrl';
import { upsertImageForImport } from '../services/import/imageWriteService';
import { createImport } from '../repositories/importsRepo';
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

const router = Router();

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

      const dedup = new Set<string>();
      let deduped = 0;

      const prisma = dryRun ? null : getPrismaClient();

      for (const item of lines) {
        const parsed = parsePixivUrl(item.url);
        if (!parsed.ok) {
          errors.push({
            ok: false,
            line: item.line,
            url: item.url,
            code: parsed.code,
            message: parsed.message,
          });
          continue;
        }

        const key = `${parsed.illustId.toString()}:${parsed.pageIndex}`;
        if (dedup.has(key)) {
          deduped += 1;
          continue;
        }
        dedup.add(key);

        const provisionalProxyPath = `/i/pending.${parsed.ext}`;

        try {
          if (!dryRun) {
            const image = await upsertImageForImport({
              illustId: parsed.illustId,
              pageIndex: parsed.pageIndex,
              ext: parsed.ext,
              originalUrl: item.url,
              proxyPath: provisionalProxyPath,
            });

            const stableProxyPath = buildStableProxyPath(image.id, parsed.ext);
            if (image.proxyPath !== stableProxyPath && prisma) {
              await prisma.image.update({ where: { id: image.id }, data: { proxyPath: stableProxyPath } });
            }

            results.push({
              ok: true,
              illust_id: parsed.illustId.toString(),
              page_index: parsed.pageIndex,
              image_id: image.id.toString(),
              ext: parsed.ext,
              original_url: item.url,
              proxy_path: stableProxyPath,
            });
            continue;
          }

          results.push({
            ok: true,
            illust_id: parsed.illustId.toString(),
            page_index: parsed.pageIndex,
            image_id: null,
            ext: parsed.ext,
            original_url: item.url,
            proxy_path: null,
          });
        } catch (err: unknown) {
          errors.push({
            ok: false,
            line: item.line,
            url: item.url,
            code: 'upsert_failed',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const totalLines = lines.length;
      const success = results.length;
      const failed = errors.length;

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
        total_lines: totalLines,
        unique_images: dedup.size,
        deduped,
        success,
        failed,
        enqueued: {
          hydrate_metadata: 0,
          note: dryRun ? 'dry_run: queue not enqueued' : 'not_implemented_yet (will be handled by pg-boss issues)',
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
