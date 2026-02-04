import { describe, expect, it, vi } from 'vitest';

import { computePrimaryBindings, ensurePrimaryBindings } from '../src/proxy/tokenProxyBinding';

function asMap(bindings: Array<{ tokenId: string; proxyId: string }>): Map<string, string> {
  return new Map(bindings.map((b) => [b.tokenId, b.proxyId]));
}

describe('computePrimaryBindings (rendezvous hashing)', () => {
  it('is deterministic and order-independent for proxy list', () => {
    const tokens = ['t1', 't2', 't3', 't4', 't5'];
    const proxiesA = ['p1', 'p2', 'p3'];
    const proxiesB = ['p3', 'p1', 'p2'];

    const a = asMap(computePrimaryBindings({ tokenIds: tokens, proxyIds: proxiesA, salt: 'pool:1' }));
    const b = asMap(computePrimaryBindings({ tokenIds: tokens, proxyIds: proxiesB, salt: 'pool:1' }));

    expect(b).toEqual(a);
  });

  it('adding a proxy only migrates tokens to the new proxy (minimal migration)', () => {
    const tokens = Array.from({ length: 50 }, (_, i) => `t${i + 1}`);
    const baseProxies = ['p1', 'p2', 'p3'];
    const added = ['p1', 'p2', 'p3', 'p4'];

    const before = asMap(computePrimaryBindings({ tokenIds: tokens, proxyIds: baseProxies, salt: 'pool:1' }));
    const after = asMap(computePrimaryBindings({ tokenIds: tokens, proxyIds: added, salt: 'pool:1' }));

    for (const tokenId of tokens) {
      const prev = before.get(tokenId);
      const next = after.get(tokenId);
      if (prev === next) continue;
      expect(next).toBe('p4');
    }
  });

  it('removing a proxy only migrates tokens that were bound to it', () => {
    const tokens = Array.from({ length: 50 }, (_, i) => `t${i + 1}`);
    const baseProxies = ['p1', 'p2', 'p3', 'p4'];
    const removed = ['p1', 'p2', 'p3'];

    const before = asMap(computePrimaryBindings({ tokenIds: tokens, proxyIds: baseProxies, salt: 'pool:1' }));
    const after = asMap(computePrimaryBindings({ tokenIds: tokens, proxyIds: removed, salt: 'pool:1' }));

    for (const tokenId of tokens) {
      const prev = before.get(tokenId);
      const next = after.get(tokenId);
      if (prev === next) continue;
      expect(prev).toBe('p4');
      expect(next).not.toBe('p4');
    }
  });
});

describe('ensurePrimaryBindings (DB persistence)', () => {
  it('creates missing bindings and only updates changed ones', async () => {
    const poolId = BigInt(1);
    const tokenIds = [BigInt(1), BigInt(2), BigInt(3)];
    const proxyIds = [BigInt(11), BigInt(22)];

    const desired = asMap(
      computePrimaryBindings({
        tokenIds: tokenIds.map((t) => t.toString()),
        proxyIds: proxyIds.map((p) => p.toString()),
        salt: 'pool:1',
      }),
    );
    const desired1 = BigInt(desired.get('1')!);
    const desired2 = BigInt(desired.get('2')!);
    const desired3 = BigInt(desired.get('3')!);

    const findMany = vi.fn(async () => [
      { tokenId: BigInt(1), primaryProxyId: desired1 },
      // Force token 2 to need an update.
      { tokenId: BigInt(2), primaryProxyId: desired2 === BigInt(11) ? BigInt(22) : BigInt(11) },
    ]);
    const create = vi.fn(async () => ({}));
    const update = vi.fn(async () => ({}));

    const prisma = {
      tokenProxyBinding: { findMany, create, update },
    } as any;

    const result = await ensurePrimaryBindings({ poolId, tokenIds, proxyIds, prisma });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.unchanged + result.updated + result.created).toBe(3);

    // Ensure the create uses the compound identity.
    const createData = create.mock.calls[0]?.[0]?.data;
    expect(createData?.poolId).toBe(poolId);
    expect(createData?.tokenId).toBe(BigInt(3));
    expect(createData?.primaryProxyId).toBe(desired3);

    expect(update.mock.calls[0]?.[0]?.where?.tokenId_poolId).toEqual({ tokenId: BigInt(2), poolId });
    expect(update.mock.calls[0]?.[0]?.data?.primaryProxyId).toBe(desired2);
  });
});
