import { describe, expect, it } from 'vitest';

import { computeScaledPrimaryBindings } from '../src/proxy/tokenProxyBinding';

describe('computeScaledPrimaryBindings', () => {
  it('uses unique proxies when proxies >= tokens (idle proxies allowed)', () => {
    const tokenIds = ['t1', 't2', 't3'];
    const proxyIds = ['p1', 'p2', 'p3', 'p4', 'p5'];

    const result = computeScaledPrimaryBindings({ tokenIds, proxyIds, salt: 'pool:1' });

    expect(result.maxTokensPerProxy).toBe(1);
    expect(new Set(result.bindings.map((b) => b.proxyId)).size).toBe(tokenIds.length);
    expect(result.idleProxyIds.length).toBe(proxyIds.length - tokenIds.length);
  });

  it('does not rebalance on proxy add when within cap (prefer minimal churn)', () => {
    const tokenIds = ['t1', 't2', 't3'];
    const baseProxies = ['p1', 'p2', 'p3'];
    const base = computeScaledPrimaryBindings({ tokenIds, proxyIds: baseProxies, salt: 'pool:1' });

    const nextProxies = ['p1', 'p2', 'p3', 'p4'];
    const next = computeScaledPrimaryBindings({
      tokenIds,
      proxyIds: nextProxies,
      currentBindings: base.bindings,
      salt: 'pool:1',
    });

    expect(next.bindings).toEqual(base.bindings);
    expect(next.idleProxyIds).toContain('p4');
  });

  it('enforces an upper bound when tokens > proxies (sharing)', () => {
    const tokenIds = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
    const proxyIds = ['p1', 'p2', 'p3'];

    const result = computeScaledPrimaryBindings({ tokenIds, proxyIds, salt: 'pool:1' });

    expect(result.maxTokensPerProxy).toBe(4);
    for (const load of Object.values(result.proxyLoads)) {
      expect(load).toBeLessThanOrEqual(4);
    }
    expect(result.idleProxyIds).toEqual([]);
  });

  it('rebalances overloaded current bindings to respect the cap', () => {
    const tokenIds = ['t1', 't2', 't3', 't4'];
    const proxyIds = ['p1', 'p2', 'p3', 'p4'];
    const currentBindings = tokenIds.map((tokenId) => ({ tokenId, proxyId: 'p1' }));

    const result = computeScaledPrimaryBindings({ tokenIds, proxyIds, currentBindings, salt: 'pool:1' });

    expect(result.proxyLoads.p1).toBe(1);
    expect(result.idleProxyIds.length).toBe(0);
  });
});

