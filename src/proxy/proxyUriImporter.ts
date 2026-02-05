import type { PrismaClient, ProxyScheme } from '@prisma/client';

import { getPrismaClient } from '../db/prismaClient';

import { parseProxyUri } from './proxyUri';

export type ProxyUriImportConflictPolicy =
  | 'overwrite'
  | 'skip_non_easy_proxies'
  | 'skip_non_manual'
  | 'skip_non_source';

export type ProxyUriImportError = {
  line: number;
  uri: string;
  error: string;
};

export type ImportProxyUriLinesParams = {
  lines: string[];
  source: string;
  sourceRef?: string;
  enabled?: boolean;
  conflictPolicy?: ProxyUriImportConflictPolicy;
  prisma?: PrismaClient;
};

export type ImportProxyUriLinesResult = {
  total_lines: number;
  imported: number;
  invalid: number;
  conflicts: number;
  errors: ProxyUriImportError[];
};

function shouldSkipByPolicy(params: {
  existingSource: string | null;
  source: string;
  conflictPolicy: ProxyUriImportConflictPolicy;
}): boolean {
  const existingSource = params.existingSource;
  if (!existingSource) return false;

  if (params.conflictPolicy === 'overwrite') return false;
  if (params.conflictPolicy === 'skip_non_source') return existingSource !== params.source;
  if (params.conflictPolicy === 'skip_non_easy_proxies') return existingSource !== 'easy_proxies';
  if (params.conflictPolicy === 'skip_non_manual') return existingSource !== 'manual';

  return false;
}

export function parseProxyUriTextLines(input: string): string[] {
  const lines = String(input ?? '').split(/\r?\n/);
  const out: string[] = [];

  for (const raw of lines) {
    const line = String(raw ?? '').trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    out.push(line);
  }

  return out;
}

export async function importProxyUriLines(params: ImportProxyUriLinesParams): Promise<ImportProxyUriLinesResult> {
  const prisma = params.prisma ?? getPrismaClient();
  const source = String(params.source || '').trim() || 'manual';
  const sourceRef = params.sourceRef ? String(params.sourceRef).trim() : '';
  const enabled = params.enabled ?? true;
  const conflictPolicy: ProxyUriImportConflictPolicy = params.conflictPolicy ?? 'overwrite';

  const lines = Array.isArray(params.lines) ? params.lines : [];
  const errors: ProxyUriImportError[] = [];
  let imported = 0;
  let invalid = 0;
  let conflicts = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const uri = String(lines[i] ?? '').trim();
    const lineNo = i + 1;
    if (!uri) continue;

    try {
      const parsed = parseProxyUri(uri);

      const existing = await prisma.proxyEndpoint.findUnique({
        where: {
          scheme_host_port_username: {
            scheme: parsed.scheme as ProxyScheme,
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
          },
        },
        select: { source: true },
      });

      if (shouldSkipByPolicy({
        existingSource: existing?.source ?? null,
        source,
        conflictPolicy,
      })) {
        conflicts += 1;
        continue;
      }

      await prisma.proxyEndpoint.upsert({
        where: {
          scheme_host_port_username: {
            scheme: parsed.scheme as ProxyScheme,
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
          },
        },
        create: {
          scheme: parsed.scheme as ProxyScheme,
          host: parsed.host,
          port: parsed.port,
          username: parsed.username,
          password: parsed.password,
          enabled,
          source,
          sourceRef: sourceRef || null,
        },
        update: {
          password: parsed.password,
          enabled,
          source,
          sourceRef: sourceRef || null,
        },
      });

      imported += 1;
    } catch (err: unknown) {
      invalid += 1;
      errors.push({
        line: lineNo,
        uri,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    total_lines: lines.length,
    imported,
    invalid,
    conflicts,
    errors,
  };
}
