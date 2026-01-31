import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  // prismaClient.ts uses a global singleton in non-production.
  // Ensure tests are isolated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__prismaClient;
  vi.resetModules();
});

describe('prismaClient wrapper', () => {
  it('returns injected client without requiring DATABASE_URL', async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const { getPrismaClient, setPrismaClientForTest } = await import('../src/db/prismaClient');

    const injectedClient = { name: 'injected' } as any;
    setPrismaClientForTest(injectedClient);
    expect(getPrismaClient()).toBe(injectedClient);

    // cleanup
    setPrismaClientForTest(undefined);
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('reuses global singleton in non-production', async () => {
    const { getPrismaClient } = await import('../src/db/prismaClient');

    const globalClient = { name: 'global' } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__prismaClient = globalClient;

    expect(getPrismaClient()).toBe(globalClient);
  });

  it('disconnectPrismaClient disconnects and clears global client', async () => {
    const { disconnectPrismaClient } = await import('../src/db/prismaClient');

    const disconnect = vi.fn(async () => undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__prismaClient = { $disconnect: disconnect };

    await disconnectPrismaClient();

    expect(disconnect).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).__prismaClient).toBeUndefined();
  });
});
