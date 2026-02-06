import { describe, expect, it, vi } from 'vitest';

import { importProxyUriLines, parseProxyUriTextLines } from '../src/proxy/proxyUriImporter';

describe('parseProxyUriTextLines', () => {
  it('drops blank/comment lines and preserves original line numbers', () => {
    const lines = parseProxyUriTextLines(`
# comment
http://127.0.0.1:8080

  socks5://user:pass@127.0.0.1:1080
`);
    expect(lines).toEqual([
      { line: 3, uri: 'http://127.0.0.1:8080' },
      { line: 5, uri: 'socks5://user:pass@127.0.0.1:1080' },
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
        { line: 2, uri: 'http://user:pa@ss@127.0.0.1:18080' },
        { line: 3, uri: 'socks5://127.0.0.1:19090' },
        { line: 7, uri: 'not-a-proxy' },
      ],
      source: 'manual',
      sourceRef: 'manual-input',
      prisma,
    });

    expect(result.total_lines).toBe(3);
    expect(result.imported).toBe(2);
    expect(result.invalid).toBe(1);
    expect(result.conflicts).toBe(0);
    expect(result.errors[0]?.line).toBe(7);
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

  it('keeps source line numbers when importing parsed text blocks', async () => {
    const findUnique = vi.fn(async () => null);
    const upsert = vi.fn(async () => ({}));
    const prisma = { proxyEndpoint: { findUnique, upsert } } as any;

    const lines = parseProxyUriTextLines(`
# easy proxies batch
http://user:pa%40ss@127.0.0.1:18080

not-a-proxy
socks5://127.0.0.1:19090
`);

    expect(lines).toEqual([
      { line: 3, uri: 'http://user:pa%40ss@127.0.0.1:18080' },
      { line: 5, uri: 'not-a-proxy' },
      { line: 6, uri: 'socks5://127.0.0.1:19090' },
    ]);

    const result = await importProxyUriLines({
      lines,
      source: 'easy_proxies',
      sourceRef: 'manual-paste',
      prisma,
    });

    expect(result.total_lines).toBe(3);
    expect(result.imported).toBe(2);
    expect(result.invalid).toBe(1);
    expect(result.errors).toEqual([
      {
        line: 5,
        uri: 'not-a-proxy',
        error: 'Proxy URI must include scheme (http/https/socks4/socks5).',
      },
    ]);

    const firstCall = upsert.mock.calls[0]?.[0];
    expect(firstCall?.create?.password).toBe('pa@ss');
    expect(firstCall?.create?.sourceRef).toBe('manual-paste');
  });
});
