import { describe, expect, it } from 'vitest';

import { importResourceOptions } from '../src/admin/resources/imports';

describe('AdminJS Import resource show.after enrichment', () => {
  it('adds job fields and AdminJobs URL from detail.job', async () => {
    const response: any = {
      record: {
        params: {
          id: '1',
          detail: {
            job: {
              enqueued_job_id: 'job-enq-1',
              last_job_id: 'job-last-2',
            },
            enqueued: { note: 'queued' },
            errors: [{ code: 'x', message: 'm', url: 'https://i.pximg.net/123_p0.jpg' }],
          },
        },
      },
    };

    const out = await (importResourceOptions.actions as any).show.after(response);
    expect(out.record.params.enqueuedJobId).toBe('job-enq-1');
    expect(out.record.params.lastJobId).toBe('job-last-2');
    expect(out.record.params.enqueueNote).toBe('queued');
    expect(out.record.params.adminJobsUrl).toBe('/admin/pages/adminJobs?job_id=job-last-2');
    expect(out.record.params.lastErrorCode).toBe('x');
    expect(out.record.params.lastErrorMessage).toBe('m');
  });

  it('falls back to enqueued_job_id when last_job_id is missing', async () => {
    const response: any = {
      record: {
        params: {
          id: '1',
          detail: { job: { enqueued_job_id: 'job-enq-1' } },
        },
      },
    };

    const out = await (importResourceOptions.actions as any).show.after(response);
    expect(out.record.params.adminJobsUrl).toBe('/admin/pages/adminJobs?job_id=job-enq-1');
  });

  it('parses detail JSON string', async () => {
    const response: any = {
      record: {
        params: {
          id: '1',
          detail: JSON.stringify({
            job: { enqueued_job_id: 'job-enq-1', last_job_id: 'job-last-2' },
            enqueued: { note: 'queued' },
          }),
        },
      },
    };

    const out = await (importResourceOptions.actions as any).show.after(response);
    expect(out.record.params.lastJobId).toBe('job-last-2');
    expect(out.record.params.adminJobsUrl).toBe('/admin/pages/adminJobs?job_id=job-last-2');
  });
});

