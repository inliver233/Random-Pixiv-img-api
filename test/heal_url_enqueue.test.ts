import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTest } from '../src/config/env';

const mockEnqueue = vi.hoisted(() => vi.fn());
const mockEnsureQueue = vi.hoisted(() => vi.fn());
const mockWork = vi.hoisted(() => vi.fn());
const mockBossCreateQueue = vi.hoisted(() => vi.fn());
const mockBossSendThrottled = vi.hoisted(() => vi.fn());

vi.mock('../src/queue/queue', () => ({
  enqueue: mockEnqueue,
  ensureQueue: mockEnsureQueue,
  work: mockWork,
}));

import { enqueueHealUrl } from '../src/jobs/healUrl';

describe('enqueueHealUrl', () => {
  beforeEach(() => {
    mockEnqueue.mockReset();
    mockEnsureQueue.mockReset();
    mockWork.mockReset();
    mockBossCreateQueue.mockReset();
    mockBossSendThrottled.mockReset();
    resetEnvForTest();
    delete process.env.HEAL_DEBOUNCE_SECONDS;
    delete process.env.HEAL_RETRY_LIMIT;
    delete process.env.HEAL_RETRY_DELAY_SECONDS;
    delete process.env.HEAL_RETRY_DELAY_MAX_SECONDS;
    delete process.env.HEAL_RETRY_BACKOFF;
  });

  it('uses pg-boss sendThrottled with debounce window (defaults to 600s)', async () => {
    mockEnsureQueue.mockResolvedValueOnce({
      sendThrottled: mockBossSendThrottled,
    });
    mockBossSendThrottled.mockResolvedValueOnce('job_1');

    const id = await enqueueHealUrl(123n);

    expect(id).toBe('job_1');
    expect(mockEnsureQueue).toHaveBeenCalledWith('heal_url');
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
    mockEnsureQueue.mockResolvedValueOnce({
      sendThrottled: mockBossSendThrottled,
    });
    mockBossSendThrottled.mockResolvedValueOnce(null);

    const id = await enqueueHealUrl(123n);
    expect(id).toBeNull();
  });

  it('propagates request_id into job payload when provided', async () => {
    mockEnsureQueue.mockResolvedValueOnce({
      sendThrottled: mockBossSendThrottled,
    });
    mockBossSendThrottled.mockResolvedValueOnce('job_3');

    const id = await enqueueHealUrl(123n, ' req-123 ');

    expect(id).toBe('job_3');
    expect(mockBossSendThrottled).toHaveBeenCalledWith(
      'heal_url',
      { illust_id: '123', request_id: 'req-123' },
      {
        retryLimit: 5,
        retryDelay: 60,
        retryBackoff: true,
        retryDelayMax: 3600,
      },
      600,
      '123',
    );
  });

  it('respects retry/backoff env overrides', async () => {
    process.env.HEAL_RETRY_LIMIT = '9';
    process.env.HEAL_RETRY_DELAY_SECONDS = '10';
    process.env.HEAL_RETRY_DELAY_MAX_SECONDS = '100';
    process.env.HEAL_RETRY_BACKOFF = '0';
    resetEnvForTest();

    mockEnsureQueue.mockResolvedValueOnce({
      sendThrottled: mockBossSendThrottled,
    });
    mockBossSendThrottled.mockResolvedValueOnce('job_2');

    const id = await enqueueHealUrl(123n);

    expect(id).toBe('job_2');
    expect(mockBossSendThrottled).toHaveBeenCalledWith(
      'heal_url',
      { illust_id: '123' },
      {
        retryLimit: 9,
        retryDelay: 10,
        retryBackoff: false,
        retryDelayMax: 100,
      },
      600,
      '123',
    );
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
