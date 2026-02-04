import { describe, expect, it, vi } from 'vitest';

import { importProxyEndpointsFromEasyProxies } from '../src/proxy/easyProxiesImporter';

function jsonResponse(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

describe('easy_proxies importer', () => {
  it('imports /api/export lines into ProxyEndpoint via upsert (idempotent)', async () => {
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input?.toString?.() ?? input ?? '');
      if (url.endsWith('/api/auth')) {
        return jsonResponse({ message: 'ok', token: 'token123' });
      }
      if (url.endsWith('/api/export')) {
        expect(String(init?.headers?.authorization || init?.headers?.Authorization || '')).toBe('Bearer token123');
        return textResponse(
          [
            'http://u:p@127.0.0.1:18080',
            'http://127.0.0.1:18081',
            'not-a-proxy',
          ].join('\n'),
        );
      }
      return jsonResponse({ error: 'not_found' }, 404);
    });

    const upsert = vi.fn(async () => ({}));
    const prisma = { proxyEndpoint: { upsert } } as any;

    const runOnce = () =>
      importProxyEndpointsFromEasyProxies({
        baseUrl: 'http://127.0.0.1:9999',
        password: 'pw',
        prisma,
        fetch: fetchMock as any,
      });

    const r1 = await runOnce();
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error('unexpected');
    expect(r1.total_lines).toBe(3);
    expect(r1.imported).toBe(2);
    expect(r1.invalid).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(2);

    // run twice should still upsert same identities (no duplicates)
    const r2 = await runOnce();
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error('unexpected');
    expect(upsert).toHaveBeenCalledTimes(4);

    const whereKeys = upsert.mock.calls.map((call) => call[0]?.where?.scheme_host_port_username);
    expect(whereKeys).toEqual([
      { scheme: 'http', host: '127.0.0.1', port: 18080, username: 'u' },
      { scheme: 'http', host: '127.0.0.1', port: 18081, username: '' },
      { scheme: 'http', host: '127.0.0.1', port: 18080, username: 'u' },
      { scheme: 'http', host: '127.0.0.1', port: 18081, username: '' },
    ]);
  });
});

