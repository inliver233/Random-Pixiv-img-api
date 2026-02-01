import { describe, expect, it } from 'vitest';

import { parsePixivUrl } from '../src/utils/parsePixivUrl';

describe('parsePixivUrl', () => {
  it('parses img-original p0 jpg', () => {
    const res = parsePixivUrl('https://i.pximg.net/img-original/img/2024/01/01/00/00/00/12345678_p0.jpg');
    expect(res).toEqual({ ok: true, illustId: 12345678n, pageIndex: 0, ext: 'jpg' });
  });

  it('parses img-original p1 png', () => {
    const res = parsePixivUrl('https://i.pximg.net/img-original/img/2024/01/01/00/00/00/12345678_p1.png');
    expect(res).toEqual({ ok: true, illustId: 12345678n, pageIndex: 1, ext: 'png' });
  });

  it('parses img-master master1200 suffix', () => {
    const res = parsePixivUrl('https://i.pximg.net/img-master/img/2024/01/01/00/00/00/12345678_p0_master1200.jpeg');
    expect(res).toEqual({ ok: true, illustId: 12345678n, pageIndex: 0, ext: 'jpeg' });
  });

  it('rejects unsupported host', () => {
    const res = parsePixivUrl('https://example.com/img-original/img/2024/01/01/00/00/00/12345678_p0.jpg');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unsupported_url');
  });

  it('rejects unsupported extension', () => {
    const res = parsePixivUrl('https://i.pximg.net/img-original/img/2024/01/01/00/00/00/12345678_p0.zip');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unsupported_url');
  });

  it('rejects empty string', () => {
    const res = parsePixivUrl('');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_url');
  });

  it('rejects non-url input', () => {
    const res = parsePixivUrl('not a url');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_url');
  });
});

