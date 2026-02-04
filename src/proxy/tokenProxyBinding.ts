import type { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../db/prismaClient';

export type PrimaryTokenProxyBinding = {
  tokenId: string;
  proxyId: string;
};

function normalizeId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function fnv1a64(input: string): bigint {
  // 64-bit FNV-1a
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = Buffer.from(input, 'utf8');
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

export function pickPrimaryProxyRendezvous(tokenId: string, proxyIds: string[], salt = ''): string {
  const t = normalizeId(tokenId, 'tokenId');
  if (!Array.isArray(proxyIds) || proxyIds.length === 0) {
    throw new Error('proxyIds must be a non-empty array.');
  }

  let bestProxy = normalizeId(proxyIds[0], 'proxyId');
  let bestScore = fnv1a64(`${t}|${bestProxy}|${salt}`);

  for (let i = 1; i < proxyIds.length; i += 1) {
    const p = normalizeId(proxyIds[i], 'proxyId');
    const score = fnv1a64(`${t}|${p}|${salt}`);
    if (score > bestScore) {
      bestProxy = p;
      bestScore = score;
      continue;
    }
    if (score === bestScore && p < bestProxy) {
      bestProxy = p;
    }
  }

  return bestProxy;
}

export function computePrimaryBindings(params: {
  tokenIds: string[];
  proxyIds: string[];
  salt?: string;
}): PrimaryTokenProxyBinding[] {
  const tokenIds = (params.tokenIds ?? []).map((t) => normalizeId(t, 'tokenId'));
  const proxyIds = (params.proxyIds ?? []).map((p) => normalizeId(p, 'proxyId'));
  if (proxyIds.length === 0) throw new Error('proxyIds must be a non-empty array.');

  const salt = params.salt ?? '';
  return tokenIds.map((tokenId) => ({
    tokenId,
    proxyId: pickPrimaryProxyRendezvous(tokenId, proxyIds, salt),
  }));
}

export type EnsurePrimaryBindingsResult = {
  created: number;
  updated: number;
  unchanged: number;
};

export async function ensurePrimaryBindings(params: {
  poolId: bigint;
  tokenIds: bigint[];
  proxyIds: bigint[];
  prisma?: PrismaClient;
}): Promise<EnsurePrimaryBindingsResult> {
  const prisma = params.prisma ?? getPrismaClient();

  const poolId = params.poolId;
  const tokenIds = params.tokenIds ?? [];
  const proxyIds = params.proxyIds ?? [];

  if (tokenIds.length === 0) return { created: 0, updated: 0, unchanged: 0 };
  if (proxyIds.length === 0) throw new Error('proxyIds must be a non-empty array.');

  const existing = await prisma.tokenProxyBinding.findMany({
    where: { poolId, tokenId: { in: tokenIds } },
    select: { tokenId: true, primaryProxyId: true },
  });

  const existingByToken = new Map<string, bigint>();
  for (const row of existing) {
    existingByToken.set(row.tokenId.toString(), row.primaryProxyId);
  }

  const desired = computePrimaryBindings({
    tokenIds: tokenIds.map((t) => t.toString()),
    proxyIds: proxyIds.map((p) => p.toString()),
    salt: `pool:${poolId.toString()}`,
  });

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const binding of desired) {
    const tokenId = BigInt(binding.tokenId);
    const primaryProxyId = BigInt(binding.proxyId);

    const prev = existingByToken.get(binding.tokenId);
    if (prev === undefined) {
      await prisma.tokenProxyBinding.create({
        data: {
          tokenId,
          poolId,
          primaryProxyId,
        },
      });
      created += 1;
      continue;
    }

    if (prev === primaryProxyId) {
      unchanged += 1;
      continue;
    }

    await prisma.tokenProxyBinding.update({
      where: { tokenId_poolId: { tokenId, poolId } },
      data: { primaryProxyId },
    });
    updated += 1;
  }

  return { created, updated, unchanged };
}

