import { describe, expect, it, vi } from 'vitest';

import { queryAdminJobs } from '../src/admin/utils/adminJobsQuery';

describe('queryAdminJobs', () => {
  it('queries recent jobs by core queues', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValueOnce([{
        id: 'job-1',
        queue: 'admin_images_import',
        state: 'created',
        created_on: new Date('2026-02-01T00:00:00.000Z'),
        data: { request_id: 'req-1' },
        output: null,
      }]),
    } as any;

    const res = await queryAdminJobs(prisma, { queues: ['admin_images_import', 'hydrate_metadata'], limit: 80 });

    const sql = prisma.$queryRaw.mock.calls[0]?.[0]?.sql;
    expect(sql).toContain('FROM pgboss.job');
    expect(sql).toContain('WHERE name IN');
    expect(sql).toContain('ORDER BY created_on DESC');
    expect(sql).toContain('LIMIT');

    expect(res.mode).toBe('recent');
    expect(res.limit).toBe(80);
    expect(res.jobs[0]).toMatchObject({ id: 'job-1', queue: 'admin_images_import' });
  });

  it('queries by job_id when a UUID is provided', async () => {
    const jobId = '123e4567-e89b-12d3-a456-426614174000';
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValueOnce([{
        id: jobId,
        queue: 'admin_pixiv_token_test_refresh',
        state: 'created',
        created_on: new Date('2026-02-01T00:00:00.000Z'),
        data: { token_id: '1' },
        output: { value: { message: 'ok' } },
      }]),
    } as any;

    const res = await queryAdminJobs(prisma, { queues: ['admin_images_import'], limit: 80, jobId });

    const sql = prisma.$queryRaw.mock.calls[0]?.[0]?.sql;
    expect(sql).toContain('WHERE name IN');
    expect(sql).toContain('id =');
    expect(sql).toContain('::uuid');
    expect(sql).toContain('LIMIT 1');

    expect(res.mode).toBe('job_id');
    expect(res.limit).toBe(1);
    expect(res.jobs).toHaveLength(1);
    expect(res.queues[0]).toBe('admin_pixiv_token_test_refresh');
  });

  it('queries by request_id when a UUID is provided', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174001';
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValueOnce([{
        id: 'job-2',
        queue: 'hydrate_metadata',
        state: 'completed',
        created_on: new Date('2026-02-01T00:00:00.000Z'),
        data: { request_id: requestId, illust_id: '1' },
        output: null,
      }]),
    } as any;

    const res = await queryAdminJobs(prisma, { queues: ['hydrate_metadata'], limit: 80, requestId });

    const sql = prisma.$queryRaw.mock.calls[0]?.[0]?.sql;
    expect(sql).toContain("data->>'request_id'");
    expect(sql).toContain('ORDER BY created_on DESC');

    expect(res.mode).toBe('request_id');
    expect(res.jobs).toHaveLength(1);
    expect(res.jobs[0]).toMatchObject({ id: 'job-2', queue: 'hydrate_metadata' });
  });
});

