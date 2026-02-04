import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTest } from '../src/config/env.ts';
import { getTokenStoreSnapshot, invalidateTokenStoreCache } from '../src/services/tokenStore.ts';

describe('getTokenStoreSnapshot', () => {
  beforeEach(() => {
    invalidateTokenStoreCache();
    resetEnvForTest();
    process.env.REFRESH_TOKENS = '["env_token_1","env_token_2"]';
  });

  it('returns DB tokens when available', async () => {
    const prisma = {
      pixivToken: {
        findMany: vi.fn(async () => [
          { id: BigInt(1), refreshToken: 'db_token_1' },
          { id: BigInt(2), refreshToken: 'db_token_2' },
        ]),
      },
    } as any;

    const snapshot = await getTokenStoreSnapshot({ prisma, cacheTtlMs: 0 });

    expect(snapshot).toEqual({
      source: 'db',
      tokens: [
        { id: '1', refreshToken: 'db_token_1' },
        { id: '2', refreshToken: 'db_token_2' },
      ],
    });
  });

  it('falls back to env tokens when DB is empty', async () => {
    const prisma = {
      pixivToken: {
        findMany: vi.fn(async () => []),
      },
    } as any;

    const snapshot = await getTokenStoreSnapshot({ prisma, cacheTtlMs: 0 });

    expect(snapshot.source).toBe('env');
    expect(snapshot.tokens).toEqual([
      { id: 'env-0', refreshToken: 'env_token_1' },
      { id: 'env-1', refreshToken: 'env_token_2' },
    ]);
  });

  it('caches snapshots within TTL', async () => {
    const prisma = {
      pixivToken: {
        findMany: vi.fn(async () => [{ id: BigInt(1), refreshToken: 'db_token_1' }]),
      },
    } as any;

    const first = await getTokenStoreSnapshot({ prisma, cacheTtlMs: 10_000 });
    const second = await getTokenStoreSnapshot({ prisma, cacheTtlMs: 10_000 });

    expect(first).toBe(second);
    expect(prisma.pixivToken.findMany).toHaveBeenCalledTimes(1);
  });

  it('invalidateTokenStoreCache forces reload', async () => {
    const prisma = {
      pixivToken: {
        findMany: vi.fn(async () => [{ id: BigInt(1), refreshToken: 'db_token_1' }]),
      },
    } as any;

    await getTokenStoreSnapshot({ prisma, cacheTtlMs: 10_000 });
    invalidateTokenStoreCache();
    await getTokenStoreSnapshot({ prisma, cacheTtlMs: 10_000 });

    expect(prisma.pixivToken.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('pixivAuthService TokenStore integration', () => {
  const mockPixivApiRequest = vi.fn();
  const mockGetTokenStoreSnapshot = vi.fn();

  async function importPixivAuthService() {
    vi.resetModules();
    vi.doMock('../src/http/axiosClient', () => ({
      pixivApiRequest: mockPixivApiRequest,
    }));
    vi.doMock('../src/services/tokenStore', () => ({
      getTokenStoreSnapshot: mockGetTokenStoreSnapshot,
    }));
    return await import('../src/services/pixivAuthService.ts');
  }

  beforeEach(() => {
    vi.useRealTimers();
    mockPixivApiRequest.mockReset();
    mockGetTokenStoreSnapshot.mockReset();
    resetEnvForTest();
    process.env.PIXIV_TOKEN_STRATEGY = 'round_robin';
  });

  it('picks up added tokens without restart', async () => {
    mockGetTokenStoreSnapshot
      .mockResolvedValueOnce({ source: 'db', tokens: [{ id: 't1', refreshToken: 'rt1' }] })
      .mockResolvedValueOnce({
        source: 'db',
        tokens: [
          { id: 't1', refreshToken: 'rt1' },
          { id: 't2', refreshToken: 'rt2' },
        ],
      });

    mockPixivApiRequest
      .mockResolvedValueOnce({
        data: { response: { access_token: 'access_1', refresh_token: 'rt1_rotated', expires_in: 3600 } },
      })
      .mockResolvedValueOnce({
        data: { response: { access_token: 'access_2', refresh_token: 'rt2_rotated', expires_in: 3600 } },
      });

    const { getAccessTokenWithMeta } = await importPixivAuthService();

    const first = await getAccessTokenWithMeta();
    expect(first.tokenIndex).toBe(0);
    expect(String(mockPixivApiRequest.mock.calls[0][0]?.data)).toContain('refresh_token=rt1');

    const second = await getAccessTokenWithMeta();
    expect(second.tokenIndex).toBe(1);
    expect(String(mockPixivApiRequest.mock.calls[1][0]?.data)).toContain('refresh_token=rt2');
  });

  it('does not overwrite in-memory rotated refreshToken with stale store value', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-04T00:00:00Z'));

    mockGetTokenStoreSnapshot
      .mockResolvedValueOnce({ source: 'db', tokens: [{ id: 't1', refreshToken: 'rt1' }] })
      .mockResolvedValueOnce({ source: 'db', tokens: [{ id: 't1', refreshToken: 'rt1' }] });

    mockPixivApiRequest
      .mockResolvedValueOnce({
        data: { response: { access_token: 'access_1', refresh_token: 'rt1_rotated', expires_in: 1 } },
      })
      .mockResolvedValueOnce({
        data: { response: { access_token: 'access_2', refresh_token: 'rt1_rotated_2', expires_in: 1 } },
      });

    const { getAccessTokenWithMeta } = await importPixivAuthService();

    await getAccessTokenWithMeta();
    expect(String(mockPixivApiRequest.mock.calls[0][0]?.data)).toContain('refresh_token=rt1');

    vi.advanceTimersByTime(1000);
    await getAccessTokenWithMeta();
    expect(String(mockPixivApiRequest.mock.calls[1][0]?.data)).toContain('refresh_token=rt1_rotated');
  });
});

