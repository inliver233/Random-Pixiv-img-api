import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTest } from '../src/config/env.ts';
import { getRuntimeConfigSnapshot, invalidateRuntimeCaches, resetRuntimeConfigForTest } from '../src/config/runtimeConfig.ts';
import { invalidateProxyEndpointCache, loadEnabledProxyCandidates } from '../src/proxy/proxyEndpointStore.ts';
import { getTokenStoreSnapshot, invalidateTokenStoreCache } from '../src/services/tokenStore.ts';

describe('runtime hot reload (single process)', () => {
  beforeEach(() => {
    resetEnvForTest();
    resetRuntimeConfigForTest();
    invalidateTokenStoreCache();
    invalidateProxyEndpointCache();
    delete process.env.DATABASE_URL;
  });

  it('caches runtime settings and reloads after invalidation', async () => {
    let settingsRows: Array<{ key: string; value: any }> = [
      { key: 'proxy_fail_closed', value: 'true' },
    ];

    const prisma = {
      runtimeSetting: {
        findMany: vi.fn(async () => settingsRows),
      },
    } as any;

    const first = await getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 10_000 });
    expect(first.config.proxyFailClosed).toBe(true);
    expect(prisma.runtimeSetting.findMany).toHaveBeenCalledTimes(1);

    settingsRows = [{ key: 'proxy_fail_closed', value: 'false' }];

    const second = await getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 10_000 });
    expect(second).toBe(first);
    expect(second.config.proxyFailClosed).toBe(true);
    expect(prisma.runtimeSetting.findMany).toHaveBeenCalledTimes(1);

    invalidateRuntimeCaches({ settings: true });

    const third = await getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 10_000 });
    expect(third.config.proxyFailClosed).toBe(false);
    expect(prisma.runtimeSetting.findMany).toHaveBeenCalledTimes(2);
  });

  it('invalidateRuntimeCaches clears token/proxy caches so new reads take effect immediately', async () => {
    let tokenRows: Array<{ id: bigint; refreshToken: string }> = [
      { id: BigInt(1), refreshToken: 'rt1' },
    ];
    let proxyRows: Array<any> = [
      { id: BigInt(1), scheme: 'http', host: '127.0.0.1', port: 8080, username: '', password: '' },
    ];

    const prisma = {
      pixivToken: {
        findMany: vi.fn(async () => tokenRows),
      },
      proxyEndpoint: {
        findMany: vi.fn(async () => proxyRows),
      },
    } as any;

    const t1 = await getTokenStoreSnapshot({ prisma, cacheTtlMs: 10_000 });
    const p1 = await loadEnabledProxyCandidates({ prisma, cacheTtlMs: 10_000 });
    expect(t1.tokens.map((t) => t.id)).toEqual(['1']);
    expect(p1.map((p) => p.id)).toEqual(['1']);
    expect(prisma.pixivToken.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.proxyEndpoint.findMany).toHaveBeenCalledTimes(1);

    tokenRows = [{ id: BigInt(2), refreshToken: 'rt2' }];
    proxyRows = [{ id: BigInt(2), scheme: 'http', host: '127.0.0.1', port: 8081, username: '', password: '' }];

    const t2 = await getTokenStoreSnapshot({ prisma, cacheTtlMs: 10_000 });
    const p2 = await loadEnabledProxyCandidates({ prisma, cacheTtlMs: 10_000 });
    expect(t2).toBe(t1);
    expect(p2).toBe(p1);
    expect(prisma.pixivToken.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.proxyEndpoint.findMany).toHaveBeenCalledTimes(1);

    invalidateRuntimeCaches({ tokens: true, proxies: true });

    const t3 = await getTokenStoreSnapshot({ prisma, cacheTtlMs: 10_000 });
    const p3 = await loadEnabledProxyCandidates({ prisma, cacheTtlMs: 10_000 });
    expect(t3.tokens.map((t) => t.id)).toEqual(['2']);
    expect(p3.map((p) => p.id)).toEqual(['2']);
    expect(prisma.pixivToken.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.proxyEndpoint.findMany).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent runtime config reloads and avoids stale overwrites', async () => {
    resetRuntimeConfigForTest();

    let resolveFindMany: ((rows: Array<{ key: string; value: any }>) => void) | null = null;
    const findMany = vi.fn(() => new Promise<any[]>((resolve) => {
      resolveFindMany = resolve;
    }));

    const prisma = {
      runtimeSetting: {
        findMany,
      },
    } as any;

    const p1 = getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 0 });
    const p2 = getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 0 });
    expect(findMany).toHaveBeenCalledTimes(1);

    resolveFindMany?.([{ key: 'proxy_retry_attempts', value: '1' }]);
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1).toBe(s2);
    expect(s1.config.proxyRetryAttempts).toBe(1);

    resetRuntimeConfigForTest();

    let resolveSlow: ((rows: Array<{ key: string; value: any }>) => void) | null = null;
    const slowFindMany = vi.fn(() => new Promise<any[]>((resolve) => {
      resolveSlow = resolve;
    }));

    const prisma2 = {
      runtimeSetting: {
        findMany: slowFindMany,
      },
    } as any;

    const slow = getRuntimeConfigSnapshot({ prisma: prisma2, cacheTtlMs: 0 });
    invalidateRuntimeCaches({ settings: true });

    resolveSlow?.([{ key: 'proxy_retry_attempts', value: '2' }]);
    await slow;

    prisma2.runtimeSetting.findMany.mockResolvedValueOnce([{ key: 'proxy_retry_attempts', value: '3' }]);
    const fresh = await getRuntimeConfigSnapshot({ prisma: prisma2, cacheTtlMs: 0 });
    expect(fresh.config.proxyRetryAttempts).toBe(3);
    expect(slowFindMany).toHaveBeenCalledTimes(2);
  });
});
