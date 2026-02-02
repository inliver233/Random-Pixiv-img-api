import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTest } from '../src/config/env';

const mockEnqueue = vi.hoisted(() => vi.fn());
const mockStartQueue = vi.hoisted(() => vi.fn());
const mockWork = vi.hoisted(() => vi.fn());
const mockBossCreateQueue = vi.hoisted(() => vi.fn());
const mockBossSendThrottled = vi.hoisted(() => vi.fn());

vi.mock('../src/queue/queue', () => ({
  enqueue: mockEnqueue,
  startQueue: mockStartQueue,
  work: mockWork,
}));

import { enqueueHealUrl } from '../src/jobs/healUrl';

describe('enqueueHealUrl', () => {
  beforeEach(() => {
    mockEnqueue.mockReset();
    mockStartQueue.mockReset();
    mockWork.mockReset();
    mockBossCreateQueue.mockReset();
    mockBossSendThrottled.mockReset();
    resetEnvForTest();
    delete process.env.HEAL_DEBOUNCE_SECONDS;
  });

  it('uses pg-boss sendThrottled with debounce window (defaults to 600s)', async () => {
    mockStartQueue.mockResolvedValueOnce({
      createQueue: mockBossCreateQueue,
      sendThrottled: mockBossSendThrottled,
    });
    mockBossSendThrottled.mockResolvedValueOnce('job_1');

    const id = await enqueueHealUrl(123n);

    expect(id).toBe('job_1');
    expect(mockBossCreateQueue).toHaveBeenCalledWith('heal_url');
    expect(mockBossSendThrottled).toHaveBeenCalledWith(
      'heal_url',
      { illust_id: '123' },
      {
        retryLimit: 5,
        retryDelay: 60,
        retryBackoff: true,
        retryDelayMax: 3600,
      },
      600,
      '123',
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('returns null when throttled (duplicate within window)', async () => {
    mockStartQueue.mockResolvedValueOnce({
      createQueue: mockBossCreateQueue,
      sendThrottled: mockBossSendThrottled,
    });
    mockBossSendThrottled.mockResolvedValueOnce(null);

    const id = await enqueueHealUrl(123n);
    expect(id).toBeNull();
  });

  it('can disable debounce via HEAL_DEBOUNCE_SECONDS=0 (falls back to enqueue)', async () => {
    process.env.HEAL_DEBOUNCE_SECONDS = '0';
    resetEnvForTest();

    mockEnqueue.mockResolvedValueOnce('job_1');

    const id = await enqueueHealUrl(123n);
    expect(id).toBe('job_1');

    expect(mockEnqueue).toHaveBeenCalledWith('heal_url', { illust_id: '123' }, {
      retryLimit: 5,
      retryDelay: 60,
      retryBackoff: true,
      retryDelayMax: 3600,
    });
    expect(mockBossSendThrottled).not.toHaveBeenCalled();
  });
});
