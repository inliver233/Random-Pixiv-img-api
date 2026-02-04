import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  // prismaClient.ts uses a global singleton in non-production.
  // Ensure tests are isolated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__prismaClient;
  vi.resetModules();
});

describe('admin audit redaction', () => {
  it('redacts refresh_token/password fields in persisted detail', async () => {
    const created: any[] = [];

    const { setPrismaClientForTest } = await import('../src/db/prismaClient');
    setPrismaClientForTest({
      adminAudit: {
        create: vi.fn(async ({ data }: any) => {
          created.push(data);
          return data;
        }),
      },
    } as any);

    const { auditAdminEvent } = await import('../src/audit/adminAudit');

    await auditAdminEvent({
      actor: 'admin_token',
      action: 'proxy_endpoint_update',
      resource: 'ProxyEndpoint',
      record_id: '1',
      request_id: 'req-1',
      ip: '127.0.0.1',
      user_agent: 'ua',
      detail: {
        refreshToken: 'pixiv_refresh_token_secret',
        refresh_token: 'pixiv_refresh_token_secret_2',
        refreshTokenMasked: '****MASKED****',
        password: 'proxy_password_secret',
        nested: { password: 'nested_proxy_password_secret' },
        proxyUrl: 'http://user:pass@example.com:8080',
        authorization: 'Bearer abc.def.ghi',
      },
    });

    expect(created).toHaveLength(1);
    expect(created[0].detail.refreshToken).toBe('[REDACTED]');
    expect(created[0].detail.refresh_token).toBe('[REDACTED]');
    expect(created[0].detail.password).toBe('[REDACTED]');
    expect(created[0].detail.nested.password).toBe('[REDACTED]');
    expect(created[0].detail.refreshTokenMasked).toBe('****MASKED****');
    expect(String(created[0].detail.proxyUrl)).not.toContain('pass');
    expect(String(created[0].detail.proxyUrl).toLowerCase()).toContain('redacted');
    expect(created[0].detail.authorization).toBe('[REDACTED]');

    // cleanup
    setPrismaClientForTest(undefined);
  });
});

describe('admin audit actor', () => {
  it('uses session admin_user when available', async () => {
    const created: any[] = [];
    const { setPrismaClientForTest } = await import('../src/db/prismaClient');
    setPrismaClientForTest({
      adminAudit: {
        create: vi.fn(async ({ data }: any) => {
          created.push(data);
          return data;
        }),
      },
    } as any);

    const { auditAdminImageStatusChange } = await import('../src/audit/adminAudit');

    auditAdminImageStatusChange({
      action: 'image_enable',
      imageId: 1n,
      toStatus: 1,
      req: {
        session: { admin_user: 'alice' },
        headers: { 'user-agent': 'ua' },
        request_id: 'req-2',
        ip: '127.0.0.1',
      },
    });

    // auditAdminImageStatusChange fires asynchronously (best-effort). Allow it to flush.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(created).toHaveLength(1);
    expect(created[0].actor).toBe('alice');

    // cleanup
    setPrismaClientForTest(undefined);
  });
});
