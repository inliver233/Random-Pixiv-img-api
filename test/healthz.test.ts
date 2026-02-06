import express from 'express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

const mockCheckDb = vi.fn();
const mockMemcachedGet = vi.fn();

function installCommonJsMocks() {
  const dbHealthPath = require.resolve('../src/db/dbHealth.js');
  require.cache[dbHealthPath] = {
    id: dbHealthPath,
    filename: dbHealthPath,
    loaded: true,
    exports: { checkDb: mockCheckDb },
  } as any;

  const memcachedServicePath = require.resolve('../src/services/memcachedService.js');
  require.cache[memcachedServicePath] = {
    id: memcachedServicePath,
    filename: memcachedServicePath,
    loaded: true,
    exports: { get: mockMemcachedGet, set: vi.fn() },
  } as any;
}

installCommonJsMocks();

function createApp() {
  const app = express();
  const healthzRoute = require('../src/routes/healthz.js');

  app.use('/healthz', healthzRoute);
  return app;
}

describe('GET /healthz', () => {
  beforeEach(() => {
    mockCheckDb.mockReset();
    mockMemcachedGet.mockReset();
  });

  it('returns 200 when db+memcached are ok', async () => {
    const app = createApp();

    mockCheckDb.mockResolvedValueOnce({ ok: true, message: null });
    mockMemcachedGet.mockResolvedValueOnce(undefined);

    const res = await request(app).get('/healthz').set('x-request-id', 'req-healthz-ok').expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.db).toEqual({ ok: true, message: null });
    expect(res.body.memcached).toEqual({ ok: true, message: null });
    expect(res.body.queue).toEqual({ ok: true, message: 'not_initialized' });
    expect(res.body.request_id).toBe('req-healthz-ok');
  });

  it('returns 503 when db is not ok', async () => {
    const app = createApp();

    mockCheckDb.mockResolvedValueOnce({ ok: false, message: 'db down' });
    mockMemcachedGet.mockResolvedValueOnce(undefined);

    const res = await request(app).get('/healthz').set('x-request-id', 'req-healthz-db-down').expect(503);

    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(res.body.message).toBe('One or more dependencies are unavailable.');
    expect(res.body.db).toEqual({ ok: false, message: 'db down' });
    expect(res.body.memcached.ok).toBe(true);
    expect(res.body.request_id).toBe('req-healthz-db-down');
  });

  it('returns 503 when memcached is not ok', async () => {
    const app = createApp();

    mockCheckDb.mockResolvedValueOnce({ ok: true, message: null });
    mockMemcachedGet.mockRejectedValueOnce(new Error('memcached down'));

    const res = await request(app).get('/healthz').set('x-request-id', 'req-healthz-memcached-down').expect(503);

    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(res.body.message).toBe('One or more dependencies are unavailable.');
    expect(res.body.db.ok).toBe(true);
    expect(res.body.memcached).toEqual({ ok: false, message: 'memcached down' });
    expect(res.body.request_id).toBe('req-healthz-memcached-down');
  });

  it('redacts credential-like fragments in dependency messages', async () => {
    const app = createApp();

    mockCheckDb.mockResolvedValueOnce({ ok: false, message: 'postgresql://alice:secret@db.local:5432/pixivcat' });
    mockMemcachedGet.mockResolvedValueOnce(undefined);

    const res = await request(app).get('/healthz').expect(503);

    expect(String(res.body.db?.message || '')).not.toContain('secret');
    expect(String(res.body.db?.message || '')).toContain('***:***@');
  });
});
