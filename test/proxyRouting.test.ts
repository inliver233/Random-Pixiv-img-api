import { describe, expect, it } from 'vitest';

import { isPixivHostname, shouldProxyUrl } from '../src/proxy/routing';

describe('proxy routing (pixiv_only)', () => {
  it('matches Pixiv OAuth hostname', () => {
    expect(isPixivHostname('oauth.secure.pixiv.net')).toBe(true);
    expect(shouldProxyUrl('https://oauth.secure.pixiv.net/auth/token')).toBe(true);
  });

  it('matches Pixiv app-api hostname', () => {
    expect(isPixivHostname('app-api.pixiv.net')).toBe(true);
    expect(shouldProxyUrl('https://app-api.pixiv.net/v1/illust/detail')).toBe(true);
  });

  it('matches pximg hosts', () => {
    expect(isPixivHostname('pximg.net')).toBe(true);
    expect(isPixivHostname('i.pximg.net')).toBe(true);
    expect(isPixivHostname('s.pximg.net')).toBe(true);
    expect(shouldProxyUrl('https://i.pximg.net/img-original/img/2020/01/01/00/00/00/1_p0.jpg')).toBe(true);
  });

  it('does not match non-pixiv hosts', () => {
    expect(shouldProxyUrl('https://example.com')).toBe(false);
    expect(shouldProxyUrl('http://127.0.0.1:3000/healthz')).toBe(false);
  });

  it('does not proxy internal service hostnames', () => {
    expect(shouldProxyUrl('http://postgres:5432')).toBe(false);
    expect(shouldProxyUrl('http://memcached:11211')).toBe(false);
  });

  it('ignores non-http(s) URLs', () => {
    expect(shouldProxyUrl('memcached://memcached:11211')).toBe(false);
    expect(shouldProxyUrl('postgresql://postgres:5432/pixivcat')).toBe(false);
  });

  it('handles invalid URLs safely', () => {
    expect(shouldProxyUrl('not a url')).toBe(false);
    expect(shouldProxyUrl('')).toBe(false);
  });
});

