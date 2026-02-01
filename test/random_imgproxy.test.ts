import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTest } from '../src/config/env';
import { setPrismaClientForTest } from '../src/db/prismaClient';
import { buildSignedImgproxyUrl } from '../src/imgproxy/imgproxy';

const require = createRequire(import.meta.url);

const requestIdMiddleware = require('../src/middlewares/requestIdMiddleware.js');
const errorHandler = require('../src/middlewares/errorHandler.js');

describe('imgproxy signing', () => {
  it('matches official signing example (HMAC-SHA256 + base64url)', () => {
    const url = buildSignedImgproxyUrl({
      baseUrl: 'http://imgproxy.example.com',
      keyHex: '736563726574', // "secret"
      saltHex: '68656C6C6F', // "hello"
      processingOptions: 'rs:fill:300:400:0/g:sm',
      sourceUrl: 'http://example.com/images/curiosity.jpg',
      extension: 'png',
      encodedChunkSize: 16,
    });

    expect(url).toBe(
      'http://imgproxy.example.com/oKfUtW34Dvo2BGQehJFR4Nr0_rIjOtdtzJ3QFsUcXH8'
        + '/rs:fill:300:400:0/g:sm'
        + '/aHR0cDovL2V4YW1w/bGUuY29tL2ltYWdl/cy9jdXJpb3NpdHku/anBn.png',
    );
  });
});

describe('GET /random (imgproxy urls.imgproxy)', () => {
  const prisma = {
    image: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    prisma.image.findFirst.mockReset();
    prisma.image.findUnique.mockReset();
    setPrismaClientForTest(prisma);

    delete process.env.IMGPROXY_URL;
    delete process.env.IMGPROXY_KEY;
    delete process.env.IMGPROXY_SALT;
    resetEnvForTest();
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    delete process.env.IMGPROXY_URL;
    delete process.env.IMGPROXY_KEY;
    delete process.env.IMGPROXY_SALT;
    resetEnvForTest();
  });

  it('omits urls.imgproxy when not configured', async () => {
    const { default: randomRoute } = await import('../src/routes/random.ts');

    prisma.image.findFirst.mockResolvedValueOnce({
      id: 1n,
      illustId: 987654321n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'http://example.com/images/curiosity.jpg',
    });
    prisma.image.findUnique.mockResolvedValueOnce({
      id: 1n,
      illustId: 987654321n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'http://example.com/images/curiosity.jpg',
      imageTags: [],
    });

    const app = express();
    app.use(requestIdMiddleware);
    app.use('/random', randomRoute);
    app.use(errorHandler);

    const res = await request(app)
      .get('/random?format=json')
      .set('x-request-id', 'req-random-imgproxy-disabled')
      .expect(200);

    expect(res.body?.urls?.imgproxy).toBeUndefined();
  });

  it('includes urls.imgproxy when configured', async () => {
    process.env.IMGPROXY_URL = 'http://imgproxy.example.com';
    process.env.IMGPROXY_KEY = '736563726574';
    process.env.IMGPROXY_SALT = '68656C6C6F';
    resetEnvForTest();

    const { default: randomRoute } = await import('../src/routes/random.ts');

    prisma.image.findFirst.mockResolvedValueOnce({
      id: 1n,
      illustId: 987654321n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'http://example.com/images/curiosity.jpg',
    });
    prisma.image.findUnique.mockResolvedValueOnce({
      id: 1n,
      illustId: 987654321n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'http://example.com/images/curiosity.jpg',
      imageTags: [],
    });

    const expectedImgproxy = buildSignedImgproxyUrl({
      baseUrl: process.env.IMGPROXY_URL,
      keyHex: process.env.IMGPROXY_KEY,
      saltHex: process.env.IMGPROXY_SALT,
      processingOptions: 'raw:1',
      sourceUrl: 'http://example.com/images/curiosity.jpg',
      extension: 'jpg',
    });

    const app = express();
    app.use(requestIdMiddleware);
    app.use('/random', randomRoute);
    app.use(errorHandler);

    const res = await request(app)
      .get('/random?format=json')
      .set('x-request-id', 'req-random-imgproxy')
      .expect(200);

    expect(res.body?.urls?.imgproxy).toBe(expectedImgproxy);
  });
});
