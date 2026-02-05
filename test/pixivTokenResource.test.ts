import { afterEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';

vi.mock('../src/audit/adminAudit', () => ({
  auditAdminModelChange: vi.fn(),
}));

vi.mock('../src/config/runtimeConfig', () => ({
  invalidateRuntimeCaches: vi.fn(),
}));

vi.mock('../src/services/pixivAuthService', async () => {
  const actual = await vi.importActual<any>('../src/services/pixivAuthService');
  return {
    ...actual,
    testRefreshToken: vi.fn(),
  };
});

import { auditAdminModelChange } from '../src/audit/adminAudit';
import { invalidateRuntimeCaches } from '../src/config/runtimeConfig';
import { testRefreshToken } from '../src/services/pixivAuthService';
import { pixivTokenResourceOptions } from '../src/admin/resources/pixivTokens';

afterEach(() => {
  vi.clearAllMocks();
  setPrismaClientForTest(undefined);
});

describe('AdminJS PixivToken resource options', () => {
  it('new.before sets refreshTokenMasked and normalizes empty label', async () => {
    const request = {
      method: 'post',
      payload: {
        label: '   ',
        refreshToken: 'abcdefghijklmnopqrstuvwxyz',
      },
    };

    const out = await (pixivTokenResourceOptions.actions as any).new.before(request);
    expect(out.payload.refreshToken).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(out.payload.refreshTokenMasked).toBe('abcd...wxyz');
    expect(out.payload.label).toBeNull();
  });

  it('edit.before keeps existing refreshToken when empty string is submitted', async () => {
    const request = {
      method: 'post',
      payload: {
        label: 'x',
        refreshToken: '',
        refreshTokenMasked: 'should_be_deleted',
      },
    };

    const out = await (pixivTokenResourceOptions.actions as any).edit.before(request);
    expect(out.payload.label).toBe('x');
    expect('refreshToken' in out.payload).toBe(false);
    expect('refreshTokenMasked' in out.payload).toBe(false);
  });

  it('new.after strips refreshToken from response record and invalidates token cache', async () => {
    const response = { record: { params: { refreshToken: 'secret', refreshTokenMasked: 'abcd...wxyz' } } };
    const request = { method: 'post', payload: { refreshToken: 'secret' } };
    const context = { record: { id: () => '1', params: { id: '1', refreshTokenMasked: 'abcd...wxyz' } } };

    const out = await (pixivTokenResourceOptions.actions as any).new.after(response, request, context);
    expect(out.record.params.refreshToken).toBeUndefined();
    expect(invalidateRuntimeCaches).toHaveBeenCalledWith({ tokens: true });
    expect(auditAdminModelChange).toHaveBeenCalled();
  });

  it('testRefresh handler reads DB token and returns notice without leaking refreshToken', async () => {
    (testRefreshToken as any).mockResolvedValueOnce({ ok: true, expires_in: 3600 });

    const prisma = {
      pixivToken: {
        findUnique: vi.fn(async () => ({
          id: BigInt(1),
          enabled: true,
          label: 't1',
          refreshToken: 'secret_refresh_token',
          refreshTokenMasked: 'secr...oken',
        })),
      },
    } as any;
    setPrismaClientForTest(prisma);

    const record = {
      params: { id: '1' },
      id: () => '1',
      toJSON: () => ({ params: { id: '1' } }),
    };

    const result = await (pixivTokenResourceOptions.actions as any).testRefresh.handler(
      { method: 'post', headers: { 'user-agent': 'ua', 'x-request-id': 'req-1' } },
      {},
      {
        record,
        currentAdmin: {},
        resource: { id: () => 'PixivToken' },
        h: { recordActionUrl: () => '/admin/resources/PixivToken/records/1/show' },
      },
    );

    expect(prisma.pixivToken.findUnique).toHaveBeenCalledTimes(1);
    expect(result.notice.type).toBe('success');
    expect(String(result.notice.message)).toContain('expires_in=3600');
    expect(JSON.stringify(result)).not.toContain('secret_refresh_token');
    expect(auditAdminModelChange).toHaveBeenCalled();
  });
});

