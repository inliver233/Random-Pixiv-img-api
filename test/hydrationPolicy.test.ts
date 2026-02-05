import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTest } from '../src/config/env.ts';
import { getRuntimeConfigSnapshot, invalidateRuntimeCaches, resetRuntimeConfigForTest } from '../src/config/runtimeConfig.ts';

describe('hydration policy runtime config', () => {
  beforeEach(() => {
    resetEnvForTest();
    resetRuntimeConfigForTest();
    delete process.env.DATABASE_URL;
  });

  it('falls back to env/defaults when no policy exists', async () => {
    process.env.ADMIN_IMPORT_MAX_HYDRATE_ILLUSTS = '1234';
    resetEnvForTest();

    const prisma = {
      runtimeSetting: { findMany: vi.fn(async () => []) },
      hydrationPolicy: { findFirst: vi.fn(async () => null) },
    } as any;

    const snapshot = await getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 10_000 });
    expect(snapshot.config.hydrateOnImport).toBe(true);
    expect(snapshot.config.opportunisticHydrate).toBe(false);
    expect(snapshot.config.adminImportMaxHydrateIllusts).toBe(1234);
  });

  it('allows runtime_setting override for adminImportMaxHydrateIllusts', async () => {
    process.env.ADMIN_IMPORT_MAX_HYDRATE_ILLUSTS = '2000';
    resetEnvForTest();

    const prisma = {
      runtimeSetting: {
        findMany: vi.fn(async () => [{ key: 'admin_import_max_hydrate_illusts', value: '5' }]),
      },
      hydrationPolicy: { findFirst: vi.fn(async () => null) },
    } as any;

    const snapshot = await getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 10_000 });
    expect(snapshot.config.adminImportMaxHydrateIllusts).toBe(5);
  });

  it('applies enabled hydration policy overrides for onImport/opportunistic toggles', async () => {
    const prisma = {
      runtimeSetting: { findMany: vi.fn(async () => []) },
      hydrationPolicy: {
        findFirst: vi.fn(async () => ({
          enabled: true,
          hydrateOnImport: false,
          opportunisticHydrate: true,
        })),
      },
    } as any;

    const snapshot = await getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 10_000 });
    expect(snapshot.config.hydrateOnImport).toBe(false);
    expect(snapshot.config.opportunisticHydrate).toBe(true);
  });

  it('disables hydration when the newest policy is disabled (and no enabled policies exist)', async () => {
    const prisma = {
      runtimeSetting: { findMany: vi.fn(async () => []) },
      hydrationPolicy: {
        findFirst: vi.fn(async () => ({
          enabled: false,
          hydrateOnImport: true,
          opportunisticHydrate: true,
        })),
      },
    } as any;

    const snapshot = await getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 10_000 });
    expect(snapshot.config.hydrateOnImport).toBe(false);
    expect(snapshot.config.opportunisticHydrate).toBe(false);
  });

  it('caches and reloads hydration policy after invalidation', async () => {
    let hydrationPolicy: any = { enabled: true, hydrateOnImport: true, opportunisticHydrate: false };

    const prisma = {
      runtimeSetting: { findMany: vi.fn(async () => []) },
      hydrationPolicy: { findFirst: vi.fn(async () => hydrationPolicy) },
    } as any;

    const first = await getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 10_000 });
    expect(first.config.hydrateOnImport).toBe(true);
    expect(prisma.hydrationPolicy.findFirst).toHaveBeenCalledTimes(1);

    hydrationPolicy = { enabled: true, hydrateOnImport: false, opportunisticHydrate: true };

    const second = await getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 10_000 });
    expect(second).toBe(first);
    expect(second.config.hydrateOnImport).toBe(true);
    expect(prisma.hydrationPolicy.findFirst).toHaveBeenCalledTimes(1);

    invalidateRuntimeCaches({ settings: true });

    const third = await getRuntimeConfigSnapshot({ prisma, cacheTtlMs: 10_000 });
    expect(third.config.hydrateOnImport).toBe(false);
    expect(third.config.opportunisticHydrate).toBe(true);
    expect(prisma.hydrationPolicy.findFirst).toHaveBeenCalledTimes(2);
  });
});

