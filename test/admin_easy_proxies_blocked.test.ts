import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/audit/adminAudit', () => ({
  auditAdminModelChange: vi.fn(),
}));

vi.mock('../src/config/runtimeConfig', () => ({
  invalidateRuntimeCaches: vi.fn(),
}));

vi.mock('../src/proxy/easyProxiesImporter', () => ({
  loadEasyProxiesRuntimeConfig: vi.fn(),
  importProxyEndpointsFromEasyProxies: vi.fn(),
}));

import { createProxyEndpointResourceOptions } from '../src/admin/resources/proxyEndpoints';
import { importProxyEndpointsFromEasyProxies, loadEasyProxiesRuntimeConfig } from '../src/proxy/easyProxiesImporter';

describe('AdminJS easy_proxies blocked semantics', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('easyProxiesImport returns an error notice when baseUrl is missing', async () => {
    (loadEasyProxiesRuntimeConfig as any).mockResolvedValueOnce({ baseUrl: null, password: null });

    const options: any = createProxyEndpointResourceOptions({});
    const handler = options.actions.easyProxiesImport.handler;

    const out = await handler(
      { method: 'post', session: { admin_user: 'admin' } },
      {},
      {
        resource: { id: () => 'ProxyEndpoint' },
        h: { resourceUrl: () => '/admin/resources/ProxyEndpoint' },
      },
    );

    expect(out.notice.type).toBe('error');
    expect(String(out.notice.message)).toContain('baseUrl');
  });

  it('easyProxiesImport calls importer and returns success notice when baseUrl is set', async () => {
    (loadEasyProxiesRuntimeConfig as any).mockResolvedValueOnce({
      baseUrl: 'https://example.com',
      password: '***',
    });

    (importProxyEndpointsFromEasyProxies as any).mockResolvedValueOnce({
      ok: true,
      baseUrl: 'https://example.com',
      total_lines: 2,
      imported: 2,
      invalid: 0,
      conflicts: 0,
      token_used: false,
    });

    const options: any = createProxyEndpointResourceOptions({});
    const handler = options.actions.easyProxiesImport.handler;

    const out = await handler(
      { method: 'post', session: { admin_user: 'admin' } },
      {},
      {
        resource: { id: () => 'ProxyEndpoint' },
        h: { resourceUrl: () => '/admin/resources/ProxyEndpoint' },
      },
    );

    expect(importProxyEndpointsFromEasyProxies).toHaveBeenCalledTimes(1);
    expect(out.notice.type).toBe('success');
    expect(String(out.notice.message)).toContain('导入完成');
  });
});

