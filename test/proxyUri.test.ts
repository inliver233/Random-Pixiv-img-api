import { describe, expect, it } from 'vitest';

import { parseProxyUri } from '../src/proxy/proxyUri';

describe('parseProxyUri', () => {
  const okCases: Array<{ input: string; expected: any }> = [
    { input: 'http://example.com', expected: { scheme: 'http', host: 'example.com', port: 80, username: '', password: '' } },
    { input: 'http://example.com:80', expected: { scheme: 'http', host: 'example.com', port: 80, username: '', password: '' } },
    { input: 'https://example.com', expected: { scheme: 'https', host: 'example.com', port: 443, username: '', password: '' } },
    { input: 'socks4://example.com', expected: { scheme: 'socks4', host: 'example.com', port: 1080, username: '', password: '' } },
    { input: 'socks5://example.com', expected: { scheme: 'socks5', host: 'example.com', port: 1080, username: '', password: '' } },
    { input: 'socks5://example.com:1081', expected: { scheme: 'socks5', host: 'example.com', port: 1081, username: '', password: '' } },
    { input: 'http://user:pass@example.com:80', expected: { scheme: 'http', host: 'example.com', port: 80, username: 'user', password: 'pass' } },
    { input: 'https://user:pass@example.com', expected: { scheme: 'https', host: 'example.com', port: 443, username: 'user', password: 'pass' } },
    { input: 'http://user@example.com:80', expected: { scheme: 'http', host: 'example.com', port: 80, username: 'user', password: '' } },
    { input: 'http://user:@example.com:80', expected: { scheme: 'http', host: 'example.com', port: 80, username: 'user', password: '' } },
    { input: 'http://:pass@example.com:80', expected: { scheme: 'http', host: 'example.com', port: 80, username: '', password: 'pass' } },
    { input: 'http://user:pa:ss@example.com:80', expected: { scheme: 'http', host: 'example.com', port: 80, username: 'user', password: 'pa:ss' } },
    { input: 'http://user:pa@ss@example.com:80', expected: { scheme: 'http', host: 'example.com', port: 80, username: 'user', password: 'pa@ss' } },
    { input: 'HTTP://Example.COM:80', expected: { scheme: 'http', host: 'example.com', port: 80, username: '', password: '' } },
    { input: '  https://Example.COM  ', expected: { scheme: 'https', host: 'example.com', port: 443, username: '', password: '' } },
    { input: 'http://my-host.example:8080', expected: { scheme: 'http', host: 'my-host.example', port: 8080, username: '', password: '' } },
    { input: 'http://127.0.0.1:8888', expected: { scheme: 'http', host: '127.0.0.1', port: 8888, username: '', password: '' } },
    { input: 'socks5://[::1]', expected: { scheme: 'socks5', host: '::1', port: 1080, username: '', password: '' } },
    { input: 'socks5://[2001:db8::1]:9999', expected: { scheme: 'socks5', host: '2001:db8::1', port: 9999, username: '', password: '' } },
    { input: 'http://u:p@[2001:db8::1]:8080', expected: { scheme: 'http', host: '2001:db8::1', port: 8080, username: 'u', password: 'p' } },
    { input: 'http://example.com:80/foo/bar?x=1', expected: { scheme: 'http', host: 'example.com', port: 80, username: '', password: '' } },
    { input: 'http://example.com:80?x=1', expected: { scheme: 'http', host: 'example.com', port: 80, username: '', password: '' } },
    { input: 'http://example.com:80#x', expected: { scheme: 'http', host: 'example.com', port: 80, username: '', password: '' } },
    { input: 'http://user%40name:pass@example.com:80', expected: { scheme: 'http', host: 'example.com', port: 80, username: 'user@name', password: 'pass' } },
    { input: 'http://user:pa%40ss@example.com:80', expected: { scheme: 'http', host: 'example.com', port: 80, username: 'user', password: 'pa@ss' } },
    { input: 'https://example.com:443/', expected: { scheme: 'https', host: 'example.com', port: 443, username: '', password: '' } },
    { input: 'socks4://example.com:1080#frag', expected: { scheme: 'socks4', host: 'example.com', port: 1080, username: '', password: '' } },
    { input: 'socks5://user:pass@EXAMPLE.com', expected: { scheme: 'socks5', host: 'example.com', port: 1080, username: 'user', password: 'pass' } },
    { input: 'http://user:pass@example.com:65535', expected: { scheme: 'http', host: 'example.com', port: 65535, username: 'user', password: 'pass' } },
    { input: 'http://user:pass@example.com:1', expected: { scheme: 'http', host: 'example.com', port: 1, username: 'user', password: 'pass' } },
  ];

  for (const { input, expected } of okCases) {
    it(`parses ${input}`, () => {
      expect(parseProxyUri(input)).toEqual(expected);
    });
  }

  it('returns a JSON-serializable object', () => {
    const parsed = parseProxyUri('http://user:pass@example.com:80');
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });

  const badCases = [
    '',
    '   ',
    'example.com:80',
    'ftp://example.com:21',
    'http://',
    'http://:80',
    'http://example.com:0',
    'http://example.com:65536',
    'http://example.com:abc',
    'http://[::1',
    'http://::1:8080',
    'socks5://[::1]noport',
  ];

  for (const input of badCases) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(() => parseProxyUri(input)).toThrow();
    });
  }
});
