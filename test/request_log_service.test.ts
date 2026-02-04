import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getEnv, resetEnvForTest } from '../src/config/env';
import { setPrismaClientForTest } from '../src/db/prismaClient';
import { maybeRecordRequestLog } from '../src/services/requestLogService';

describe('requestLogService', () => {
  const prisma = {
    requestLog: {
      create: vi.fn(async () => undefined),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  } as any;

  const prevEnv: Record<string, string | undefined> = {};
  const keys = [
    'REQUEST_LOG_ENABLED',
    'REQUEST_LOG_SAMPLE_RATE',
    'REQUEST_LOG_PATH_PREFIXES',
    'REQUEST_LOG_RETENTION_DAYS',
  ];

  beforeEach(() => {
    for (const key of keys) prevEnv[key] = process.env[key];
    setPrismaClientForTest(prisma);
    prisma.requestLog.create.mockClear();
    prisma.requestLog.deleteMany.mockClear();
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    for (const key of keys) {
      if (prevEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevEnv[key];
    }
    resetEnvForTest();
  });

  it('writes a sampled request log row when enabled', async () => {
    process.env.REQUEST_LOG_ENABLED = 'true';
    process.env.REQUEST_LOG_SAMPLE_RATE = '1';
    process.env.REQUEST_LOG_PATH_PREFIXES = '/random';
    process.env.REQUEST_LOG_RETENTION_DAYS = '0';
    resetEnvForTest();

    const env = getEnv();
    expect(env.REQUEST_LOG_ENABLED).toBe(true);
    expect(env.REQUEST_LOG_SAMPLE_RATE).toBe(1);
    expect(env.REQUEST_LOG_PATH_PREFIXES).toBe('/random');
    expect(env.REQUEST_LOG_RETENTION_DAYS).toBe(0);

    const req: any = {
      method: 'GET',
      baseUrl: '/random',
      path: '/',
      originalUrl: '/random?format=json',
      ip: '127.0.0.1',
      header: (name: string) => (name.toLowerCase() === 'user-agent' ? 'ua-test' : ''),
      request_id: 'req-1',
    };
    const res: any = {
      statusCode: 200,
      locals: { request_id: 'req-1' },
    };

    await maybeRecordRequestLog({
      req,
      res,
      routeLabel: '/random/',
      durationMs: 12,
    });

    expect(prisma.requestLog.create).toHaveBeenCalledTimes(1);
    const call = prisma.requestLog.create.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      data: expect.objectContaining({
        requestId: 'req-1',
        method: 'GET',
        route: '/random/',
        url: '/random?format=json',
        status: 200,
        durationMs: 12,
        ip: '127.0.0.1',
        userAgent: 'ua-test',
        sampleRate: 1,
      }),
    });
  });

  it('does nothing when sample rate is 0', async () => {
    process.env.REQUEST_LOG_ENABLED = 'true';
    process.env.REQUEST_LOG_SAMPLE_RATE = '0';
    process.env.REQUEST_LOG_PATH_PREFIXES = '/random';
    process.env.REQUEST_LOG_RETENTION_DAYS = '0';
    resetEnvForTest();

    await maybeRecordRequestLog({
      req: { method: 'GET', baseUrl: '/random', path: '/', originalUrl: '/random', ip: '127.0.0.1', header: () => '' } as any,
      res: { statusCode: 200, locals: {} } as any,
      routeLabel: '/random/',
      durationMs: 1,
    });

    expect(prisma.requestLog.create).not.toHaveBeenCalled();
  });

  it('respects path prefixes allowlist', async () => {
    process.env.REQUEST_LOG_ENABLED = 'true';
    process.env.REQUEST_LOG_SAMPLE_RATE = '1';
    process.env.REQUEST_LOG_PATH_PREFIXES = '/random';
    process.env.REQUEST_LOG_RETENTION_DAYS = '0';
    resetEnvForTest();

    await maybeRecordRequestLog({
      req: { method: 'GET', baseUrl: '/images', path: '/', originalUrl: '/images', ip: '127.0.0.1', header: () => '' } as any,
      res: { statusCode: 200, locals: {} } as any,
      routeLabel: '/images/',
      durationMs: 1,
    });

    expect(prisma.requestLog.create).not.toHaveBeenCalled();
  });
});
