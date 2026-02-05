import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('pixivAuthService refresh backoff', () => {
  beforeEach(async () => {
    vi.resetModules();

    const env = await import('../src/config/env');
    env.resetEnvForTest();

    const tokenStore = await import('../src/services/tokenStore');
    tokenStore.invalidateTokenStoreCache();

    delete process.env.DATABASE_URL;
    process.env.REFRESH_TOKENS = '["bad_refresh_token"]';
    process.env.PIXIV_TOKEN_STRATEGY = 'round_robin';
  });

  it('backs off after refresh failure and skips until retry time', async () => {
    const err = Object.assign(new Error('invalid_grant'), {
      code: 'ERR_BAD_REQUEST',
      response: { status: 401 },
    });

    const svc = await import('../src/services/pixivAuthService.ts');
    const pixivApiRequestMock = vi.fn().mockRejectedValue(err);
    svc.setPixivApiRequestOverrideForTest(pixivApiRequestMock);

    await expect(svc.getAccessToken()).rejects.toThrow(/in backoff until/i);
    expect(pixivApiRequestMock).toHaveBeenCalledTimes(1);

    const states = await svc.getPixivTokenRuntimeStates();
    expect(states.ok).toBe(true);
    if (states.ok) {
      expect(states.source).toBe('env');
      expect(states.tokens).toHaveLength(1);
      expect(states.tokens[0]?.refresh_fail_count).toBe(1);
      expect(states.tokens[0]?.backoff_until).not.toBeNull();
      expect(states.tokens[0]?.last_error?.status).toBe(401);
    }

    await expect(svc.getAccessToken()).rejects.toThrow(/in backoff until/i);
    expect(pixivApiRequestMock).toHaveBeenCalledTimes(1);

    svc.setPixivApiRequestOverrideForTest(null);
  });
});
