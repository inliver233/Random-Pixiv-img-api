import { describe, expect, it, vi } from 'vitest';

const mockEnqueue = vi.hoisted(() => vi.fn());

vi.mock('../src/queue/queue', () => ({
  enqueue: mockEnqueue,
  work: vi.fn(),
}));

import { enqueueHealUrl } from '../src/jobs/healUrl';

describe('enqueueHealUrl', () => {
  it('uses exponential backoff retry options', async () => {
    mockEnqueue.mockResolvedValueOnce('job_1');

    await enqueueHealUrl(123n);

    expect(mockEnqueue).toHaveBeenCalledWith(
      'heal_url',
      { illust_id: '123' },
      {
        retryLimit: 5,
        retryDelay: 60,
        retryBackoff: true,
        retryDelayMax: 3600,
      },
    );
  });
});

