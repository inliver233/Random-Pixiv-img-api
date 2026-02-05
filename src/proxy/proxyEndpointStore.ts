import type { PrismaClient, ProxyEndpoint } from '@prisma/client';

import { getPrismaClient } from '../db/prismaClient';

import { ensureProxyHealthSchedulerStarted, filterProxyCandidatesByHealth } from './healthCheck';

export type ProxyCandidate = {
  id: string;
  proxyUri: string;
};

type ProxyEndpointInput = Pick<ProxyEndpoint, 'id' | 'scheme' | 'host' | 'port' | 'username' | 'password'>;

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatProxyEndpointCache: { fetchedAt: number; candidates: ProxyCandidate[] } | undefined;
}

const DEFAULT_CACHE_TTL_MS = 1000;

function formatHostForUri(host: string): string {
  const h = String(host ?? '').trim();
  if (!h) throw new Error('Proxy host is required.');
  if (h.includes(':') && !h.startsWith('[') && !h.endsWith(']')) return `[${h}]`;
  return h;
}

function buildProxyUri(endpoint: ProxyEndpointInput): string {
  const scheme = String(endpoint.scheme ?? '').trim().toLowerCase();
  const host = formatHostForUri(String(endpoint.host ?? ''));
  const port = Number(endpoint.port);
  if (!scheme) throw new Error('Proxy scheme is required.');
  if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error('Proxy port is invalid.');

  const username = String(endpoint.username ?? '');
  const password = String(endpoint.password ?? '');
  const authNeeded = username !== '' || password !== '';
  const auth = authNeeded
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : '';

  return `${scheme}://${auth}${host}:${port}`;
}

export function invalidateProxyEndpointCache(): void {
  globalThis.__pixivcatProxyEndpointCache = undefined;
}

export async function loadEnabledProxyCandidates(params: {
  prisma?: PrismaClient;
  cacheTtlMs?: number;
} = {}): Promise<ProxyCandidate[]> {
  const ttl = params.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = Date.now();

  const cached = globalThis.__pixivcatProxyEndpointCache;
  if (cached && now - cached.fetchedAt < ttl) {
    ensureProxyHealthSchedulerStarted();
    return filterProxyCandidatesByHealth(cached.candidates);
  }

  const prisma = params.prisma ?? getPrismaClient();

  try {
    const rows = await prisma.proxyEndpoint.findMany({
      where: { enabled: true },
      select: { id: true, scheme: true, host: true, port: true, username: true, password: true },
      orderBy: { id: 'asc' },
    });

    const candidates = rows.map((row) => ({
      id: row.id.toString(),
      proxyUri: buildProxyUri(row as any),
    }));

    globalThis.__pixivcatProxyEndpointCache = { fetchedAt: now, candidates };
    ensureProxyHealthSchedulerStarted();
    return filterProxyCandidatesByHealth(candidates);
  } catch {
    globalThis.__pixivcatProxyEndpointCache = { fetchedAt: now, candidates: [] };
    return [];
  }
}
