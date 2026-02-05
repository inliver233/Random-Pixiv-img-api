import { describe, expect, it, vi } from 'vitest';

import { importProxyUriLines, parseProxyUriTextLines } from '../src/proxy/proxyUriImporter';

describe('parseProxyUriTextLines', () => {
  it('drops blank and comment lines', () => {
    const lines = parseProxyUriTextLines(`
# comment
http://127.0.0.1:8080

  socks5://user:pass@127.0.0.1:1080
`);
    expect(lines).toEqual([
      'http://127.0.0.1:8080',
      'socks5://user:pass@127.0.0.1:1080',
    ]);
  });
});

describe('importProxyUriLines', () => {
  it('imports valid lines and supports @ in password', async () => {
    const findUnique = vi.fn(async () => null);
    const upsert = vi.fn(async () => ({}));
    const prisma = { proxyEndpoint: { findUnique, upsert } } as any;

    const result = await importProxyUriLines({
      lines: [
        'http://user:pa@ss@127.0.0.1:18080',
        'socks5://127.0.0.1:19090',
        'not-a-proxy',
      ],
      source: 'manual',
      sourceRef: 'manual-input',
      prisma,
    });

    expect(result.total_lines).toBe(3);
    expect(result.imported).toBe(2);
    expect(result.invalid).toBe(1);
    expect(result.conflicts).toBe(0);
    expect(upsert).toHaveBeenCalledTimes(2);

    const firstCall = upsert.mock.calls[0]?.[0];
    expect(firstCall?.create?.password).toBe('pa@ss');
    expect(firstCall?.create?.source).toBe('manual');
    expect(firstCall?.create?.sourceRef).toBe('manual-input');
  });

  it('respects skip_non_easy_proxies policy', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ source: 'manual' })
      .mockResolvedValueOnce(null);
    const upsert = vi.fn(async () => ({}));
    const prisma = { proxyEndpoint: { findUnique, upsert } } as any;

    const result = await importProxyUriLines({
      lines: [
        'http://127.0.0.1:18080',
        'http://127.0.0.1:18081',
      ],
      source: 'easy_proxies',
      conflictPolicy: 'skip_non_easy_proxies',
      prisma,
    });

    expect(result.imported).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(result.invalid).toBe(0);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
