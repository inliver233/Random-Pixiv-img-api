import express from 'express';
import path from 'node:path';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import tagsRoute from '../src/routes/tags.ts';
import authorsRoute from '../src/routes/authors.ts';
import imagesRoute from '../src/routes/images.ts';

const require = createRequire(import.meta.url);

const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');
const errorHandler = require('../src/middlewares/errorHandler.js');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'views'));

  app.use(requestIdMiddleware);
  app.use('/tags', tagsRoute);
  app.use('/authors', authorsRoute);
  app.use('/images', imagesRoute);
  app.use(errorHandler);

  return app;
}

describe('Classification APIs (/tags /authors /images)', () => {
  const prisma = {
    tag: {
      findMany: vi.fn(),
    },
    image: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  } as any;

  beforeEach(() => {
    prisma.tag.findMany.mockReset();
    prisma.image.groupBy.mockReset();
    prisma.image.findMany.mockReset();
    prisma.$queryRaw.mockReset();
    setPrismaClientForTest(prisma);
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
  });

  it('GET /tags returns paginated tag search results', async () => {
    prisma.tag.findMany.mockResolvedValueOnce([
      { id: 1n, name: 'cat', translatedName: '猫', _count: { imageTags: 5 } },
      { id: 2n, name: 'dog', translatedName: null, _count: { imageTags: 2 } },
      { id: 3n, name: 'bird', translatedName: null, _count: { imageTags: 1 } },
    ]);

    const app = createApp();

    const res = await request(app)
      .get('/tags?limit=2')
      .set('x-request-id', 'req-tags-200')
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      items: [
        { id: 1, name: 'cat', translated_name: '猫', image_count: 5 },
        { id: 2, name: 'dog', translated_name: null, image_count: 2 },
      ],
      next_cursor: '2',
    });

    expect(prisma.tag.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { id: 'asc' },
      take: 3,
      select: {
        id: true,
        name: true,
        translatedName: true,
        _count: { select: { imageTags: true } },
      },
    });
  });

  it('GET /authors returns paginated author search results with counts', async () => {
    prisma.image.groupBy.mockResolvedValueOnce([
      { userId: 10n, _count: { _all: 5 } },
      { userId: 11n, _count: { _all: 2 } },
      { userId: 12n, _count: { _all: 1 } },
    ]);
    prisma.image.findMany.mockResolvedValueOnce([
      { userId: 10n, userName: 'alice' },
      { userId: 11n, userName: 'alina' },
    ]);

    const app = createApp();

    const res = await request(app)
      .get('/authors?q=ali&limit=2')
      .set('x-request-id', 'req-authors-200')
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      items: [
        { user_id: 10, user_name: 'alice', image_count: 5 },
        { user_id: 11, user_name: 'alina', image_count: 2 },
      ],
      next_cursor: '11',
    });

    expect(prisma.image.groupBy).toHaveBeenCalled();
    expect(prisma.image.findMany).toHaveBeenCalledWith({
      where: {
        userId: { in: [10n, 11n] },
        userName: { not: null },
      },
      distinct: ['userId'],
      orderBy: { updatedAt: 'desc' },
      select: { userId: true, userName: true },
    });
  });

  it('GET /images returns paginated image list with tags', async () => {
    prisma.image.findMany.mockResolvedValueOnce([
      {
        id: 5n,
        illustId: 100n,
        pageIndex: 0,
        ext: 'jpg',
        width: 800,
        height: 600,
        xRestrict: 0,
        userId: 999n,
        userName: 'author',
        status: 1,
        imageTags: [{ tag: { name: 't1' } }, { tag: { name: 't2' } }],
      },
      {
        id: 4n,
        illustId: 101n,
        pageIndex: 1,
        ext: 'png',
        width: null,
        height: null,
        xRestrict: null,
        userId: null,
        userName: null,
        status: 2,
        imageTags: [],
      },
      {
        id: 3n,
        illustId: 102n,
        pageIndex: 0,
        ext: 'jpg',
        width: 1200,
        height: 900,
        xRestrict: 0,
        userId: 1n,
        userName: 'x',
        status: 1,
        imageTags: [],
      },
    ]);

    const app = createApp();

    const res = await request(app)
      .get('/images?limit=2')
      .set('x-request-id', 'req-images-list-200')
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      items: [
        {
          id: 5,
          illust_id: 100,
          page_index: 0,
          ext: 'jpg',
          width: 800,
          height: 600,
          x_restrict: 0,
          user_id: 999,
          user_name: 'author',
          status: 'active',
          tags: ['t1', 't2'],
        },
        {
          id: 4,
          illust_id: 101,
          page_index: 1,
          ext: 'png',
          width: null,
          height: null,
          x_restrict: null,
          user_id: null,
          user_name: null,
          status: 'disabled',
          tags: [],
        },
      ],
      next_cursor: '4',
    });
  });

  it('GET /images supports min_pixels via raw SQL path', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 3n }, { id: 2n }, { id: 1n }]);
    prisma.image.findMany.mockResolvedValueOnce([
      {
        id: 3n,
        illustId: 200n,
        pageIndex: 0,
        ext: 'jpg',
        width: 10,
        height: 10,
        xRestrict: 0,
        userId: 1n,
        userName: 'a',
        status: 1,
        imageTags: [],
      },
      {
        id: 2n,
        illustId: 201n,
        pageIndex: 0,
        ext: 'jpg',
        width: 10,
        height: 10,
        xRestrict: 0,
        userId: 1n,
        userName: 'a',
        status: 1,
        imageTags: [],
      },
    ]);

    const app = createApp();

    const res = await request(app)
      .get('/images?limit=2&min_pixels=100')
      .set('x-request-id', 'req-images-min-pixels')
      .expect(200);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.image.findMany).toHaveBeenCalledWith({
      where: { id: { in: [3n, 2n] } },
      include: { imageTags: { include: { tag: true } } },
      orderBy: { id: 'desc' },
    });

    expect(res.body.next_cursor).toBe('2');
    expect(res.body.items).toHaveLength(2);
  });
});

