import express from 'express';
import path from 'node:path';
import { createRequire } from 'node:module';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import randomRoute from '../src/routes/random.ts';

import { readableFromBuffer } from './helpers/mockStream';

const mockPickRandomImageRecord = vi.hoisted(() => vi.fn());
const mockPickRandomImageStream = vi.hoisted(() => vi.fn());

vi.mock('../src/services/randomService', () => ({
  pickRandomImageRecord: mockPickRandomImageRecord,
  pickRandomImageStream: mockPickRandomImageStream,
}));

const require = createRequire(import.meta.url);
const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');
const errorHandler = require('../src/middlewares/errorHandler.js');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'views'));

  app.use(requestIdMiddleware);
  app.use('/random', randomRoute);
  app.use(errorHandler);

  return app;
}

type FilterCase = {
  name: string;
  qs: string;
  filters: Record<string, any>;
};

const FILTER_CASES: FilterCase[] = [
  { name: 'base', qs: '', filters: { xRestrict: 0 } },
  { name: 'r18_1', qs: 'r18=1', filters: { xRestrict: 1 } },
  { name: 'r18_2', qs: 'r18=2', filters: { xRestrict: 2 } },
  { name: 'r18_strict', qs: 'r18=0&r18_strict=1', filters: { xRestrict: 0, xRestrictAllowUnknown: false } },
  { name: 'orientation', qs: 'orientation=portrait', filters: { xRestrict: 0, orientation: 1 } },
  { name: 'min_width', qs: 'min_width=800', filters: { xRestrict: 0, minWidth: 800 } },
  { name: 'min_height', qs: 'min_height=600', filters: { xRestrict: 0, minHeight: 600 } },
  { name: 'min_pixels', qs: 'min_pixels=100', filters: { xRestrict: 0, minPixels: 100 } },
  { name: 'included_tags', qs: 'included_tags=cat|dog', filters: { xRestrict: 0, includedTags: ['cat', 'dog'] } },
  { name: 'excluded_tags', qs: 'excluded_tags=r18|r18g', filters: { xRestrict: 0, excludedTags: ['r18', 'r18g'] } },
];

function joinQuery(parts: string[]): string {
  const filtered = parts.map((p) => String(p || '').trim()).filter((p) => p !== '');
  return filtered.join('&');
}

function stubImage(id: bigint, ext: string, originUrl: string) {
  return {
    id,
    illustId: 123n,
    pageIndex: 0,
    ext,
    originalUrl: originUrl,
    xRestrict: 0,
    width: 800,
    height: 600,
    orientation: 1,
    userId: 999n,
    userName: 'author',
    imageTags: [{ tag: { name: 't1' } }, { tag: { name: 't2' } }],
  };
}

describe('GET /random contract (30+ combinations)', () => {
  beforeEach(() => {
    mockPickRandomImageRecord.mockReset();
    mockPickRandomImageStream.mockReset();
  });

  it.each(FILTER_CASES.map((c, idx) => ({
    name: c.name,
    query: joinQuery([idx === 0 ? 'format=json' : '', 'redirect=1', c.qs]),
    expectedFilters: c.filters,
  })))('redirect mode: $name', async ({ query, expectedFilters }) => {
    mockPickRandomImageRecord.mockResolvedValueOnce(stubImage(10n, 'jpg', 'https://example.test/o.jpg'));

    const app = createApp();

    const res = await request(app)
      .get(`/random?${query}`)
      .set('x-request-id', `req-random-redirect-${expectedFilters.xRestrict}`)
      .expect(302);

    expect(res.headers.location).toBe('/i/10.jpg');
    expect(mockPickRandomImageRecord).toHaveBeenCalledTimes(1);
    expect(mockPickRandomImageRecord.mock.calls[0]?.[0]).toEqual(expectedFilters);
    expect(typeof mockPickRandomImageRecord.mock.calls[0]?.[1]).toBe('function');
  });

  it.each(FILTER_CASES.map((c, idx) => ({
    name: c.name,
    query: joinQuery(['format=json', `seed=demo-${idx}`, 'attempts=3', c.qs]),
    expectedFilters: c.filters,
  })))('json mode: $name', async ({ query, expectedFilters }) => {
    mockPickRandomImageRecord.mockImplementationOnce(async (_filters: any, _random: any, options: any) => {
      if (options?.debug) {
        options.debug.pickedBy = 'random_key';
      }
      return stubImage(11n, 'png', 'https://example.test/o.png');
    });

    const app = createApp();

    const res = await request(app)
      .get(`/random?${query}`)
      .set('x-request-id', `req-random-json-${expectedFilters.xRestrict}`)
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      id: 11,
      illust_id: 123,
      page_index: 0,
      urls: { proxy: '/i/11.png', origin: 'https://example.test/o.png' },
      cache: { max_age: 31536000 },
      debug: { attempt: 3, picked_by: 'random_key' },
    });

    expect(mockPickRandomImageRecord).toHaveBeenCalledTimes(1);
    expect(mockPickRandomImageRecord.mock.calls[0]?.[0]).toEqual(expectedFilters);
    expect(typeof mockPickRandomImageRecord.mock.calls[0]?.[1]).toBe('function');
    expect(mockPickRandomImageRecord.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ withTags: true, debug: expect.any(Object) }));
  });

  it.each(FILTER_CASES.map((c, idx) => ({
    name: c.name,
    query: joinQuery(['format=image', `seed=img-${idx}`, 'attempts=2', c.qs]),
    expectedFilters: c.filters,
  })))('image mode: $name', async ({ query, expectedFilters }) => {
    mockPickRandomImageStream.mockResolvedValueOnce({
      image: stubImage(12n, 'jpg', 'https://example.test/o.jpg'),
      originUrl: 'https://example.test/o.jpg',
      stream: readableFromBuffer(Buffer.from('img')),
      attemptsUsed: 1,
    });

    const app = createApp();

    const res = await request(app)
      .get(`/random?${query}`)
      .set('x-request-id', `req-random-image-${expectedFilters.xRestrict}`)
      .buffer(true)
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-origin-url']).toBe('https://example.test/o.jpg');
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.isBuffer(res.body)).toBe(true);

    expect(mockPickRandomImageStream).toHaveBeenCalledTimes(1);
    expect(mockPickRandomImageStream.mock.calls[0]?.[0]).toEqual(expectedFilters);
    expect(mockPickRandomImageStream.mock.calls[0]?.[1]).toBe(2);
    expect(mockPickRandomImageStream.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    expect(typeof mockPickRandomImageStream.mock.calls[0]?.[3]).toBe('function');
  });

  it('seed produces a reproducible random sequence (same seed => same first value)', async () => {
    const captured: number[] = [];

    mockPickRandomImageRecord.mockImplementation(async (_filters: any, random: any) => {
      captured.push(Number(random()));
      return stubImage(20n, 'jpg', 'https://example.test/o.jpg');
    });

    const app = createApp();

    await request(app).get('/random?redirect=1&seed=stable-seed').expect(302);
    await request(app).get('/random?redirect=1&seed=stable-seed').expect(302);

    expect(captured.length).toBe(2);
    expect(captured[0]).toBe(captured[1]);
  });
});

