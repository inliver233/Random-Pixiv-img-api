import type { PrismaClient, ProxyScheme } from '@prisma/client';

import { getPrismaClient } from '../db/prismaClient';

import { easyProxiesExport } from './easyProxiesClient';
import { parseProxyUri } from './proxyUri';

export type EasyProxiesImportParams = {
  baseUrl: string;
  password?: string;
  sourceRef?: string;
  enabled?: boolean;
  prisma?: PrismaClient;
  fetch?: typeof fetch;
};

export type EasyProxiesImportResult =
  | {
      ok: true;
      baseUrl: string;
      total_lines: number;
      imported: number;
      invalid: number;
      token_used: boolean;
      errors: Array<{ line: number; uri: string; error: string }>;
    }
  | { ok: false; baseUrl: string; status: number; error: string };

function normalizeBaseUrl(baseUrl: string): string {
  const raw = String(baseUrl ?? '').trim();
  if (!raw) throw new Error('easy_proxies baseUrl is required.');
  const u = new URL(raw);
  return u.origin;
}

export async function importProxyEndpointsFromEasyProxies(params: EasyProxiesImportParams): Promise<EasyProxiesImportResult> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);

  const exportRes = await easyProxiesExport({
    baseUrl,
    password: params.password,
    fetch: params.fetch,
  });

  if (!exportRes.ok) {
    return { ok: false, baseUrl, status: exportRes.status, error: exportRes.error };
  }

  const prisma = params.prisma ?? getPrismaClient();
  const enabled = params.enabled ?? true;
  const sourceRef = params.sourceRef ?? baseUrl;

  const errors: Array<{ line: number; uri: string; error: string }> = [];
  let imported = 0;
  let invalid = 0;

  for (let i = 0; i < exportRes.lines.length; i += 1) {
    const uri = exportRes.lines[i]!;
    const lineNo = i + 1;

    try {
      const parsed = parseProxyUri(uri);

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
          source: 'easy_proxies',
          sourceRef,
        },
        update: {
          password: parsed.password,
          enabled,
          source: 'easy_proxies',
          sourceRef,
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
    ok: true,
    baseUrl,
    total_lines: exportRes.lines.length,
    imported,
    invalid,
    token_used: Boolean(exportRes.token),
    errors,
  };
}

