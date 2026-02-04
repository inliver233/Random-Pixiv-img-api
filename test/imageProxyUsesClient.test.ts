import { Writable } from 'node:stream';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchPixivImageStream = vi.fn(async (_url: string, _signal: AbortSignal) => ({
  status: 200,
  data: Readable.from(['img']),
}));

const query = vi.fn(async (sql: string) => {
  if (sql.startsWith('SELECT original_url')) {
    return { rows: [{ original_url: 'https://i.pximg.net/img-original/img/2020/01/01/00/00/00/1_p0.jpg' }] };
  }
  return { rows: [] };
});

vi.mock('../src/http/pixivImageHttp', () => ({
  fetchPixivImageStream,
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = query;
    constructor() {}
  },
}));

class MockResponse extends Writable {
  headersSent = false;
  statusCode: number | null = null;
  headers: Record<string, any> = {};

  constructor() {
    super();
  }

  _write(_chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    callback();
  }

  writeHead(status: number, headers: Record<string, any>) {
    this.headersSent = true;
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
    return this;
  }

  status(status: number) {
    this.statusCode = status;
    return this as any;
  }

  render(_view: string, _model: any) {
    return this as any;
  }

  redirect(_status: number, _url: string) {
    return this as any;
  }
}

afterEach(() => {
  fetchPixivImageStream.mockClear();
  query.mockClear();
  delete process.env.DATABASE_URL;
  vi.resetModules();
});

describe('imageProxyController uses pixivImageHttp (no direct axios)', () => {
  it('fetches image stream via fetchPixivImageStream', async () => {
    process.env.DATABASE_URL = 'postgresql://ignored-by-mock';

    const controller = (await import('../src/controllers/imageProxyController.ts')).default as any;

    const req = { params: { illustId: '1', fileExtension: 'jpg' } } as any;
    const res = new MockResponse() as any;

    await controller.getIllustSingle(req, res);

    expect(fetchPixivImageStream).toHaveBeenCalledTimes(1);
    expect(fetchPixivImageStream.mock.calls[0]?.[0]).toContain('https://i.pximg.net/');
    expect(fetchPixivImageStream.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  });
});
