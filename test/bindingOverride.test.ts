import { describe, expect, it } from 'vitest';

import { planOverride, resolveEffectiveProxy } from '../src/proxy/tokenProxyBinding';

describe('resolveEffectiveProxy', () => {
  it('uses primary when no override exists', () => {
    const r = resolveEffectiveProxy({ primaryProxyId: 'p1' }, new Date('2026-02-04T00:00:00Z'));
    expect(r).toEqual({ proxyId: 'p1', mode: 'primary' });
  });

  it('uses override when not expired', () => {
    const now = new Date('2026-02-04T00:00:00Z');
    const r = resolveEffectiveProxy(
      { primaryProxyId: 'p1', overrideProxyId: 'p2', overrideExpiresAt: new Date('2026-02-04T00:10:00Z') },
      now,
    );
    expect(r).toEqual({ proxyId: 'p2', mode: 'override' });
  });

  it('falls back to primary when override expired', () => {
    const now = new Date('2026-02-04T00:10:00Z');
    const r = resolveEffectiveProxy(
      { primaryProxyId: 'p1', overrideProxyId: 'p2', overrideExpiresAt: new Date('2026-02-04T00:09:59Z') },
      now,
    );
    expect(r).toEqual({ proxyId: 'p1', mode: 'primary' });
  });
});

describe('planOverride', () => {
  it('picks a new proxy excluding the failed one and sets TTL', () => {
    const now = new Date('2026-02-04T00:00:00Z');
    const planned = planOverride({
      tokenId: 't1',
      poolSalt: 'pool:1',
      failedProxyId: 'p1',
      availableProxyIds: ['p1', 'p2', 'p3'],
      ttlMs: 60_000,
      now,
      reason: 'proxy_connect',
    });

    expect(planned).not.toBeNull();
    if (!planned) throw new Error('unexpected');
    expect(planned.overrideProxyId).not.toBe('p1');
    expect(planned.overrideExpiresAt.toISOString()).toBe('2026-02-04T00:01:00.000Z');
    expect(planned.reason).toBe('proxy_connect');
  });

  it('returns null when no alternative proxies exist', () => {
    const planned = planOverride({
      tokenId: 't1',
      poolSalt: 'pool:1',
      failedProxyId: 'p1',
      availableProxyIds: ['p1'],
      ttlMs: 60_000,
      now: new Date('2026-02-04T00:00:00Z'),
    });

    expect(planned).toBeNull();
  });

  it('is deterministic and order-independent for candidates', () => {
    const now = new Date('2026-02-04T00:00:00Z');
    const a = planOverride({
      tokenId: 't1',
      poolSalt: 'pool:1',
      failedProxyId: 'p1',
      availableProxyIds: ['p1', 'p2', 'p3', 'p4'],
      ttlMs: 60_000,
      now,
    });
    const b = planOverride({
      tokenId: 't1',
      poolSalt: 'pool:1',
      failedProxyId: 'p1',
      availableProxyIds: ['p4', 'p3', 'p2', 'p1'],
      ttlMs: 60_000,
      now,
    });

    expect(a?.overrideProxyId).toBe(b?.overrideProxyId);
  });
});

