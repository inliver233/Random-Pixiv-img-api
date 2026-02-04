import type { PrismaClient } from '@prisma/client';

import { getEnv } from '../config/env';
import { getPrismaClient } from '../db/prismaClient';

export type TokenStoreSource = 'db' | 'env';

export type TokenStoreToken = {
  id: string;
  refreshToken: string;
};

export type TokenStoreSnapshot = {
  source: TokenStoreSource;
  tokens: TokenStoreToken[];
};

declare global {
  // eslint-disable-next-line no-var
  var __pixivcatTokenStoreCache: { fetchedAt: number; snapshot: TokenStoreSnapshot } | undefined;
}

const DEFAULT_CACHE_TTL_MS = 1000;

function hasDatabaseUrl(): boolean {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

function loadEnvTokens(): TokenStoreToken[] {
  const env = getEnv();
  return env.REFRESH_TOKENS.map((refreshToken, idx) => ({ id: `env-${idx}`, refreshToken }));
}

async function loadDbTokens(prisma: PrismaClient): Promise<TokenStoreToken[]> {
  const rows = await prisma.pixivToken.findMany({
    where: { enabled: true },
    select: { id: true, refreshToken: true },
    orderBy: { id: 'asc' },
  });

  return rows.map((row) => ({ id: row.id.toString(), refreshToken: row.refreshToken }));
}

export function invalidateTokenStoreCache(): void {
  globalThis.__pixivcatTokenStoreCache = undefined;
}

export async function getTokenStoreSnapshot(params: {
  prisma?: PrismaClient;
  cacheTtlMs?: number;
} = {}): Promise<TokenStoreSnapshot> {
  const ttl = params.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = Date.now();

  const cached = globalThis.__pixivcatTokenStoreCache;
  if (cached && now - cached.fetchedAt < ttl) {
    return cached.snapshot;
  }

  let snapshot: TokenStoreSnapshot | null = null;

  if (params.prisma || hasDatabaseUrl()) {
    try {
      const prisma = params.prisma ?? getPrismaClient();
      const dbTokens = await loadDbTokens(prisma);
      if (dbTokens.length > 0) {
        snapshot = { source: 'db', tokens: dbTokens };
      }
    } catch {
      // Fallback to env tokens when DB is unavailable.
    }
  }

  snapshot ??= { source: 'env', tokens: loadEnvTokens() };

  globalThis.__pixivcatTokenStoreCache = { fetchedAt: now, snapshot };
  return snapshot;
}

