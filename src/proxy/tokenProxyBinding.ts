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

function scoreTokenProxyPair(tokenId: string, proxyId: string, salt: string): bigint {
  return fnv1a64(`${tokenId}|${proxyId}|${salt}`);
}

function rankProxiesForToken(tokenId: string, proxyIds: string[], salt: string): string[] {
  return proxyIds
    .map((proxyId) => ({ proxyId, score: scoreTokenProxyPair(tokenId, proxyId, salt) }))
    .sort((a, b) => {
      if (a.score > b.score) return -1;
      if (a.score < b.score) return 1;
      if (a.proxyId < b.proxyId) return -1;
      if (a.proxyId > b.proxyId) return 1;
      return 0;
    })
    .map((entry) => entry.proxyId);
}

export type ComputeScaledBindingsResult = {
  bindings: PrimaryTokenProxyBinding[];
  maxTokensPerProxy: number;
  proxyLoads: Record<string, number>;
  idleProxyIds: string[];
};

export function computeScaledPrimaryBindings(params: {
  tokenIds: string[];
  proxyIds: string[];
  currentBindings?: PrimaryTokenProxyBinding[];
  salt?: string;
  maxTokensPerProxy?: number;
}): ComputeScaledBindingsResult {
  const tokenIds = (params.tokenIds ?? []).map((t) => normalizeId(t, 'tokenId'));
  const proxyIds = (params.proxyIds ?? []).map((p) => normalizeId(p, 'proxyId'));
  if (proxyIds.length === 0) throw new Error('proxyIds must be a non-empty array.');

  const salt = params.salt ?? '';
  const targetMaxTokensPerProxy =
    params.maxTokensPerProxy ??
    (proxyIds.length >= tokenIds.length ? 1 : Math.max(1, Math.ceil(tokenIds.length / proxyIds.length)));

  const bindingsByToken = new Map<string, string>();
  const loads = new Map<string, number>();
  for (const proxyId of proxyIds) loads.set(proxyId, 0);

  const current = params.currentBindings ?? [];
  for (const binding of current) {
    if (!binding) continue;
    const tokenId = normalizeId(binding.tokenId, 'tokenId');
    const proxyId = normalizeId(binding.proxyId, 'proxyId');
    if (!tokenIds.includes(tokenId)) continue;
    if (!loads.has(proxyId)) continue;
    if (bindingsByToken.has(tokenId)) continue;

    bindingsByToken.set(tokenId, proxyId);
    loads.set(proxyId, (loads.get(proxyId) ?? 0) + 1);
  }

  const tokensNeedingAssign: string[] = [];
  for (const tokenId of tokenIds) {
    if (!bindingsByToken.has(tokenId)) tokensNeedingAssign.push(tokenId);
  }

  // Enforce per-proxy upper bound: keep the most "affine" tokens, move the rest.
  if (targetMaxTokensPerProxy > 0) {
    const tokensByProxy = new Map<string, string[]>();
    for (const [tokenId, proxyId] of bindingsByToken.entries()) {
      const list = tokensByProxy.get(proxyId) ?? [];
      list.push(tokenId);
      tokensByProxy.set(proxyId, list);
    }

    for (const proxyId of proxyIds) {
      const assigned = tokensByProxy.get(proxyId) ?? [];
      if (assigned.length <= targetMaxTokensPerProxy) continue;

      const rankedTokens = assigned
        .map((tokenId) => ({ tokenId, score: scoreTokenProxyPair(tokenId, proxyId, salt) }))
        .sort((a, b) => {
          if (a.score > b.score) return -1;
          if (a.score < b.score) return 1;
          if (a.tokenId < b.tokenId) return -1;
          if (a.tokenId > b.tokenId) return 1;
          return 0;
        })
        .map((entry) => entry.tokenId);

      const toKeep = new Set(rankedTokens.slice(0, targetMaxTokensPerProxy));
      for (const tokenId of rankedTokens.slice(targetMaxTokensPerProxy)) {
        bindingsByToken.delete(tokenId);
        tokensNeedingAssign.push(tokenId);
      }
      tokensByProxy.set(proxyId, rankedTokens.filter((t) => toKeep.has(t)));
      loads.set(proxyId, targetMaxTokensPerProxy);
    }
  }

  tokensNeedingAssign.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const tokenId of tokensNeedingAssign) {
    const ranked = rankProxiesForToken(tokenId, proxyIds, salt);
    let picked = ranked[0]!;
    for (const proxyId of ranked) {
      const load = loads.get(proxyId) ?? 0;
      if (load < targetMaxTokensPerProxy) {
        picked = proxyId;
        break;
      }
    }
    bindingsByToken.set(tokenId, picked);
    loads.set(picked, (loads.get(picked) ?? 0) + 1);
  }

  const proxyLoads: Record<string, number> = {};
  const idleProxyIds: string[] = [];
  for (const proxyId of proxyIds) {
    const load = loads.get(proxyId) ?? 0;
    proxyLoads[proxyId] = load;
    if (load === 0) idleProxyIds.push(proxyId);
  }

  return {
    bindings: tokenIds.map((tokenId) => ({ tokenId, proxyId: bindingsByToken.get(tokenId)! })),
    maxTokensPerProxy: targetMaxTokensPerProxy,
    proxyLoads,
    idleProxyIds,
  };
}

export type EnsurePrimaryBindingsResult = {
  created: number;
  updated: number;
  unchanged: number;
};

export type TokenProxyBindingOverride = {
  overrideProxyId: string;
  overrideExpiresAt: Date;
  reason: string;
};

export type TokenProxyBindingLike = {
  primaryProxyId: string;
  overrideProxyId?: string | null;
  overrideExpiresAt?: Date | null;
};

export function resolveEffectiveProxy(binding: TokenProxyBindingLike, now: Date = new Date()): {
  proxyId: string;
  mode: 'primary' | 'override';
} {
  const primaryProxyId = normalizeId(binding.primaryProxyId, 'primaryProxyId');
  const overrideProxyId = binding.overrideProxyId ? normalizeId(binding.overrideProxyId, 'overrideProxyId') : null;
  const overrideExpiresAt = binding.overrideExpiresAt ?? null;

  if (overrideProxyId && overrideExpiresAt instanceof Date && Number.isFinite(overrideExpiresAt.getTime())) {
    if (overrideExpiresAt.getTime() > now.getTime()) {
      return { proxyId: overrideProxyId, mode: 'override' };
    }
  }

  return { proxyId: primaryProxyId, mode: 'primary' };
}

export function planOverride(params: {
  tokenId: string;
  poolSalt: string;
  failedProxyId: string;
  availableProxyIds: string[];
  ttlMs: number;
  now?: Date;
  reason?: string;
}): TokenProxyBindingOverride | null {
  const tokenId = normalizeId(params.tokenId, 'tokenId');
  const failedProxyId = normalizeId(params.failedProxyId, 'failedProxyId');
  const poolSalt = String(params.poolSalt ?? '').trim();
  const ttlMs = Number(params.ttlMs);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttlMs must be a positive number.');

  const now = params.now ?? new Date();
  const candidates = (params.availableProxyIds ?? [])
    .map((p) => normalizeId(p, 'proxyId'))
    .filter((p) => p !== failedProxyId);

  if (candidates.length === 0) return null;

  const picked = pickPrimaryProxyRendezvous(tokenId, candidates, poolSalt);
  return {
    overrideProxyId: picked,
    overrideExpiresAt: new Date(now.getTime() + ttlMs),
    reason: params.reason ?? 'proxy_failure',
  };
}

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
