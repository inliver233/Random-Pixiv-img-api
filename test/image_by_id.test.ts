import express from 'express';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import imageByIdController from '../src/controllers/imageByIdController';
import imageByIdRoute from '../src/routes/imageById.ts';

import { readableFromBuffer } from './helpers/mockStream';

const mockAxiosGet = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    get: mockAxiosGet,
  },
}));

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'views'));

  app.use('/i', imageByIdRoute);
  return app;
}

describe('GET /i/:id.:ext', () => {
  const prisma = {
    image: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    setPrismaClientForTest(prisma);
    prisma.image.findUnique.mockReset();
    prisma.image.update.mockReset();
    mockAxiosGet.mockReset();
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
  });

  it('streams image with long-cache headers when record exists', async () => {
    const originUrl = 'https://i.pximg.net/img-original/img/2026/02/01/00/00/00/123_p0.jpg';
    prisma.image.findUnique.mockResolvedValueOnce({ id: 1n, ext: 'jpg', originalUrl: originUrl });

    mockAxiosGet.mockResolvedValueOnce({ data: readableFromBuffer(Buffer.from('hello')) } as any);

    const app = createApp();

    const res = await request(app).get('/i/1.jpg').buffer(true).expect(200);

    expect(res.headers['cache-control']).toContain('max-age=31536000');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['x-origin-url']).toBe(originUrl);
    expect(res.headers['x-crawl-date']).toBeDefined();
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString('utf8')).toBe('hello');
    expect(prisma.image.update).not.toHaveBeenCalled();
  });

  it('returns 404 when record does not exist', async () => {
    prisma.image.findUnique.mockResolvedValueOnce(null);

    const app = createApp();

    const res = await request(app).get('/i/1.jpg').expect(404);

    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('404');
    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(prisma.image.update).not.toHaveBeenCalled();
  });

  it('marks fail_count when upstream returns 404', async () => {
    const originUrl = 'https://i.pximg.net/img-original/img/2026/02/01/00/00/00/123_p0.jpg';
    prisma.image.findUnique.mockResolvedValueOnce({ id: 1n, ext: 'jpg', originalUrl: originUrl });

    mockAxiosGet.mockRejectedValueOnce({ response: { status: 404 } });
    prisma.image.update.mockResolvedValueOnce({ id: 1n });

    const app = createApp();

    const res = await request(app).get('/i/1.jpg').expect(404);

    expect(res.text).toContain('404');
    expect(prisma.image.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: {
        failCount: { increment: 1 },
        lastFailAt: expect.any(Date),
        lastErrorCode: 'upstream_404',
        lastErrorMsg: 'upstream status 404',
        status: 3,
      },
    });
  });

  it('does not mark fail_count on client disconnect (request abort)', async () => {
    const originUrl = 'https://i.pximg.net/img-original/img/2026/02/01/00/00/00/123_p0.jpg';
    prisma.image.findUnique.mockResolvedValueOnce({ id: 1n, ext: 'jpg', originalUrl: originUrl });

    const abortNotified = vi.fn();
    const res = new EventEmitter() as any;
    res.headersSent = false;
    res.status = vi.fn(() => res);
    res.render = vi.fn(() => res);
    res.writeHead = vi.fn(() => {
      res.headersSent = true;
    });
    res.end = vi.fn();

    mockAxiosGet.mockImplementationOnce((_url: string, config: any) => {
      const signal: AbortSignal | undefined = config?.signal;
      setTimeout(() => res.emit('close'), 0);
      return new Promise((_, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            abortNotified();
            reject({ code: 'ERR_CANCELED' });
          },
          { once: true },
        );
      });
    });

    const req = { params: { id: '1', ext: 'jpg' } } as any;
    await imageByIdController.getImageById(req, res);

    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(abortNotified).toHaveBeenCalledTimes(1);
    expect(prisma.image.update).not.toHaveBeenCalled();
  });
});
