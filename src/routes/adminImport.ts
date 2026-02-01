import { Router } from 'express';
import fs from 'node:fs/promises';

import { getPrismaClient } from '../db/prismaClient';
import { parsePixivUrl } from '../utils/parsePixivUrl';
import { upsertImageForImport } from '../services/import/imageWriteService';
import { createImport } from '../repositories/importsRepo';
import { auditAdminEvent } from '../audit/adminAudit';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const formidable = require('express-formidable') as (options?: any) => any;

type ImportOkRow = {
  ok: true;
  illust_id: string;
  page_index: number;
  image_id: string;
  ext: string;
  original_url: string;
  proxy_path: string;
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
  import_id: string;
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
  formidable({ multiples: false }),
  (req, res, next) => {
    (async () => {
      const fields = (req as any).fields || {};
      const files = (req as any).files || {};

      const textarea =
        normalizeText(fields.urls)
        || normalizeText(fields.text)
        || normalizeText(fields.textarea)
        || normalizeText(fields.input);

      const fileText = await readUploadFileText(files.file || files.upload || files.urls);

      const combined = [textarea, fileText].filter((v) => v && v.trim()).join('\n');
      const lines = readLines(combined);

      const errors: ImportErrorRow[] = [];
      const results: ImportOkRow[] = [];

      const dedup = new Set<string>();
      let deduped = 0;

      const prisma = getPrismaClient();

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
          const image = await upsertImageForImport({
            illustId: parsed.illustId,
            pageIndex: parsed.pageIndex,
            ext: parsed.ext,
            originalUrl: item.url,
            proxyPath: provisionalProxyPath,
          });

          const stableProxyPath = buildStableProxyPath(image.id, parsed.ext);
          if (image.proxyPath !== stableProxyPath) {
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

      const importRecord = await createImport({
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

      const response: ImportResponse = {
        ok: true,
        import_id: importRecord.id.toString(),
        total_lines: totalLines,
        unique_images: dedup.size,
        deduped,
        success,
        failed,
        enqueued: {
          hydrate_metadata: 0,
          note: 'not_implemented_yet (will be handled by pg-boss issues)',
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
