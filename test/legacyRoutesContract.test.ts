import express from 'express';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import corsMiddleware from '../src/middlewares/cors.ts';
import { pixivDetailMulti, pixivDetailSingle } from './helpers/pixivFixtures';

const require = createRequire(import.meta.url);

const mockAxiosGet = vi.fn();
const mockPgQuery = vi.fn();
const mockPixivGetPixivIllustIdData = vi.fn();

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
  const showVersion = require('../src/middlewares/headerMiddleware.js');
  const pixivRoutes = require('../src/routes/pixivRoutes.js');
  const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');
  const errorHandler = require('../src/middlewares/errorHandler.js');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'views'));
  app.use(requestIdMiddleware);
  app.use(corsMiddleware);
  app.use('/', showVersion, pixivRoutes);
  app.use(errorHandler);
  return app;
}

describe('legacy pixivcat routes contract', () => {
  beforeEach(() => {
    process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/pixivcat?schema=public';

    mockAxiosGet.mockReset();
    mockPgQuery.mockReset();
    mockPixivGetPixivIllustIdData.mockReset();

    mockPgQuery.mockResolvedValue({ rows: [] });
  });

  it('streams single image from DB original_url and skips Pixiv API', async () => {
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
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['x-origin-url']).toBe(originUrl);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf8')).toBe('db');
    expect(mockPixivGetPixivIllustIdData).not.toHaveBeenCalled();
  });

  it('redirects single route to page 1 when DB indicates multi-page work', async () => {
    const app = createLegacyApp();

    const originUrl = 'https://i.pximg.net/img-original/123_p0.jpg';
    mockPgQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT original_url')) return { rows: [{ original_url: originUrl }] };
      if (sql.includes('page_index > 0')) return { rows: [{ '1': 1 }] };
      return { rows: [] };
    });

    const res = await request(app).get('/123.jpg').expect(301);

    expect(res.headers.location).toBe('/123-1.jpg');
    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(mockPixivGetPixivIllustIdData).not.toHaveBeenCalled();
  });

  it('redirects single route to page 1 when Pixiv API reports multi-page work and DB miss', async () => {
    const app = createLegacyApp();

    mockPixivGetPixivIllustIdData.mockResolvedValueOnce(
      pixivDetailMulti({
        illustId: 123,
        originalUrls: ['https://i.pximg.net/img-original/123_p0.jpg', 'https://i.pximg.net/img-original/123_p1.jpg'],
      }),
    );

    const res = await request(app).get('/123.jpg').expect(301);

    expect(res.headers.location).toBe('/123-1.jpg');
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('streams requested page when Pixiv API reports multi-page work and DB miss', async () => {
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

  it('streams multi-page image from DB original_url and skips Pixiv API', async () => {
    const app = createLegacyApp();

    const originUrl = 'https://i.pximg.net/img-original/123_p1.png';
    mockPgQuery.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT original_url')) {
        const pageIndex = Number(params?.[1] ?? 0);
        if (pageIndex === 1) return { rows: [{ original_url: originUrl }] };
        return { rows: [] };
      }
      return { rows: [] };
    });

    mockAxiosGet.mockResolvedValueOnce({
      data: Readable.from([Buffer.from('db2')]),
    } as any);

    const res = await request(app).get('/123-2.png').buffer(true).expect(200);

    expect(res.headers['x-origin-url']).toBe(originUrl);
    expect(res.headers['content-type']).toContain('image/png');
    expect(mockPixivGetPixivIllustIdData).not.toHaveBeenCalled();
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf8')).toBe('db2');
  });

  it('streams single image when Pixiv API reports single-page work and DB miss', async () => {
    const app = createLegacyApp();

    const originUrl = 'https://i.pximg.net/img-original/123_p0.webp';
    mockPixivGetPixivIllustIdData.mockResolvedValueOnce(pixivDetailSingle({ illustId: 123, originalUrl: originUrl }));

    mockAxiosGet.mockResolvedValueOnce({
      data: Readable.from([Buffer.from('single')]),
    } as any);

    const res = await request(app).get('/123.webp').buffer(true).expect(200);

    expect(res.headers['x-origin-url']).toBe(originUrl);
    expect(res.headers['content-type']).toContain('image/webp');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf8')).toBe('single');
  });

  it('redirects legacy page=0 to the canonical first page (page=1)', async () => {
    const app = createLegacyApp();

    const res = await request(app).get('/123-0.jpg').expect(301);

    expect(res.headers.location).toBe('/123-1.jpg');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
