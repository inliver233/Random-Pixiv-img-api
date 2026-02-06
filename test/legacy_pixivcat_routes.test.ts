import express from 'express';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pixivDetailMulti, pixivDetailSingle } from './helpers/pixivFixtures';
import corsMiddleware from '../src/middlewares/cors.ts';

const require = createRequire(import.meta.url);

const mockAxiosGet = vi.fn();
const mockPixivGetPixivIllustIdData = vi.fn();
const mockPgQuery = vi.fn();

function installCommonJsMocks() {
  const axiosPath = require.resolve('axios');
  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: { get: mockAxiosGet },
  } as any;

  const pgPath = require.resolve('pg');
  require.cache[pgPath] = {
    id: pgPath,
    filename: pgPath,
    loaded: true,
    exports: {
      Pool: class MockPool {
        query(...args: any[]) {
          return mockPgQuery(...args);
        }
      },
    },
  } as any;

  const pixivServicePath = require.resolve('../src/services/pixivService.js');
  require.cache[pixivServicePath] = {
    id: pixivServicePath,
    filename: pixivServicePath,
    loaded: true,
    exports: { getPixivIllustIdData: mockPixivGetPixivIllustIdData },
  } as any;
}

installCommonJsMocks();

function createLegacyApp() {
  const app = express();

  const showVersion = require('../src/middlewares/headerMiddleware.js');
  const pixivRoutes = require('../src/routes/pixivRoutes.js');
  const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');
  const errorHandler = require('../src/middlewares/errorHandler.js');

  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'views'));

  app.use(requestIdMiddleware);
  app.use(corsMiddleware);
  app.use('/', showVersion, pixivRoutes);
  app.use(errorHandler);
  return app;
}

describe('legacy pixivcat routes', () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockPixivGetPixivIllustIdData.mockReset();
    mockPgQuery.mockReset();
    mockPgQuery.mockResolvedValue({ rows: [] });
  });

  it('validates illustId', async () => {
    const app = createLegacyApp();

    const res = await request(app).get('/abc.jpg').expect(400);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.code).toBe('BAD_REQUEST');
    expect(res.body.message).toContain('Invalid ID format');
    expect(typeof res.body.request_id).toBe('string');
  });

  it('validates extension', async () => {
    const app = createLegacyApp();

    const res = await request(app).get('/123.txt').expect(400);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.code).toBe('BAD_REQUEST');
    expect(res.body.message).toContain('Invalid file extension');
    expect(typeof res.body.request_id).toBe('string');
  });

  it('redirects single route when work has multiple pages', async () => {
    const app = createLegacyApp();

    mockPixivGetPixivIllustIdData.mockResolvedValueOnce(
      pixivDetailMulti({
        illustId: 123,
        originalUrls: ['https://i.pximg.net/img-original/123_p0.jpg', 'https://i.pximg.net/img-original/123_p1.jpg'],
      }),
    );

    const res = await request(app).get('/123.jpeg').expect(301);
    expect(res.headers.location).toBe('/123-1.jpeg');
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('streams single image with long-cache headers', async () => {
    const app = createLegacyApp();

    const originUrl = 'https://i.pximg.net/img-original/123_p0.jpg';
    mockPixivGetPixivIllustIdData.mockResolvedValueOnce(
      pixivDetailSingle({ illustId: 123, originalUrl: originUrl }),
    );

    mockAxiosGet.mockResolvedValueOnce({
      data: Readable.from([Buffer.from('hello')]),
    } as any);

    const res = await request(app).get('/123.jpg').buffer(true).expect(200);

    expect(res.headers['cache-control']).toContain('max-age=31536000');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['x-origin-url']).toBe(originUrl);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf8')).toBe('hello');
  });

  it('uses DB original_url when present and skips Pixiv API', async () => {
    const app = createLegacyApp();

    const originUrl = 'https://i.pximg.net/img-original/123_p0.jpg';
    mockPgQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT original_url')) return { rows: [{ original_url: originUrl }] };
      if (sql.includes('page_index > 0')) return { rows: [] };
      return { rows: [] };
    });

    mockAxiosGet.mockResolvedValueOnce({
      data: Readable.from([Buffer.from('db')]),
    } as any);

    const res = await request(app).get('/123.jpg').buffer(true).expect(200);

    expect(res.headers['cache-control']).toContain('max-age=31536000');
    expect(res.headers['x-origin-url']).toBe(originUrl);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(mockPixivGetPixivIllustIdData).not.toHaveBeenCalled();
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf8')).toBe('db');
  });

  it('streams webp image with long-cache headers', async () => {
    const app = createLegacyApp();

    const originUrl = 'https://i.pximg.net/img-original/123_p0.webp';
    mockPixivGetPixivIllustIdData.mockResolvedValueOnce(pixivDetailSingle({ illustId: 123, originalUrl: originUrl }));

    mockAxiosGet.mockResolvedValueOnce({
      data: Readable.from([Buffer.from('webp')]),
    } as any);

    const res = await request(app).get('/123.webp').buffer(true).expect(200);

    expect(res.headers['cache-control']).toContain('max-age=31536000');
    expect(res.headers['x-origin-url']).toBe(originUrl);
    expect(res.headers['content-type']).toContain('image/webp');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf8')).toBe('webp');
  });

  it('streams multi image page with long-cache headers', async () => {
    const app = createLegacyApp();

    const originUrl = 'https://i.pximg.net/img-original/123_p1.png';
    mockPixivGetPixivIllustIdData.mockResolvedValueOnce(
      pixivDetailMulti({
        illustId: 123,
        originalUrls: ['https://i.pximg.net/img-original/123_p0.png', originUrl],
      }),
    );

    mockAxiosGet.mockResolvedValueOnce({
      data: Readable.from([Buffer.from('ok')]),
    } as any);

    const res = await request(app).get('/123-2.png').buffer(true).expect(200);

    expect(res.headers['cache-control']).toContain('max-age=31536000');
    expect(res.headers['x-origin-url']).toBe(originUrl);
    expect(res.headers['content-type']).toContain('image/png');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf8')).toBe('ok');
  });
});
