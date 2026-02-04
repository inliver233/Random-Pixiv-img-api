import { describe, expect, it } from 'vitest';

import { ProxyPool } from '../src/proxy/proxyPool';

describe('ProxyPool', () => {
  it('picks sequentially and cycles', () => {
    const pool = new ProxyPool(
      [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      { mode: 'sequential', blacklistTtlMs: 1000, failureThreshold: 2, now: () => 0 },
    );

    expect(pool.pick()?.id).toBe('p1');
    expect(pool.pick()?.id).toBe('p2');
    expect(pool.pick()?.id).toBe('p3');
    expect(pool.pick()?.id).toBe('p1');
  });

  it('skips blacklisted endpoints in sequential mode', () => {
    let t = 0;
    const now = () => t;

    const pool = new ProxyPool(
      [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      { mode: 'sequential', blacklistTtlMs: 1000, failureThreshold: 1, now },
    );

    expect(pool.pick()?.id).toBe('p1');
    pool.reportFailure('p2'); // blacklists p2 immediately
    expect(pool.pick()?.id).toBe('p3');

    t = 2000; // blacklist expired
    expect(pool.isBlacklisted('p2')).toBe(false);

    const picks = [pool.pick()?.id, pool.pick()?.id];
    expect(picks).toContain('p2');
  });

  it('picks deterministically with injected random()', () => {
    const rng = (() => {
      const values = [0.0, 0.99, 0.5];
      let idx = 0;
      return () => values[idx++ % values.length]!;
    })();

    const pool = new ProxyPool(
      [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      { mode: 'random', blacklistTtlMs: 1000, failureThreshold: 2, now: () => 0, random: rng },
    );

    expect(pool.pick()?.id).toBe('p1');
    expect(pool.pick()?.id).toBe('p3');
    expect(pool.pick()?.id).toBe('p2');
  });

  it('balances picks across endpoints (tokens>proxies scenario)', () => {
    const pool = new ProxyPool(
      [{ id: 'p1' }, { id: 'p2' }],
      { mode: 'balance', blacklistTtlMs: 1000, failureThreshold: 2, now: () => 0 },
    );

    const picked: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      picked.push(pool.pick()!.id);
    }

    const p1 = picked.filter((x) => x === 'p1').length;
    const p2 = picked.filter((x) => x === 'p2').length;
    expect(Math.abs(p1 - p2)).toBeLessThanOrEqual(1);
  });

  it('blacklists after N failures and recovers after TTL', () => {
    let t = 0;
    const now = () => t;

    const pool = new ProxyPool(
      [{ id: 'p1' }, { id: 'p2' }],
      { mode: 'sequential', blacklistTtlMs: 1000, failureThreshold: 2, now },
    );

    pool.reportFailure('p1');
    expect(pool.isBlacklisted('p1')).toBe(false);
    pool.reportFailure('p1');
    expect(pool.isBlacklisted('p1')).toBe(true);

    // With p1 blacklisted, only p2 can be selected.
    expect(pool.pick()?.id).toBe('p2');

    t = 2000;
    expect(pool.isBlacklisted('p1')).toBe(false);
    expect(pool.pick()?.id).toBe('p1');
  });
});
