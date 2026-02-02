import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureQueue, getDeadLetterQueueName, resetQueueForTest } from '../src/queue/queue';

describe('queue dead-letter (DLQ)', () => {
  beforeEach(() => {
    resetQueueForTest();
    process.env.QUEUE_DEAD_LETTER_ENABLED = 'true';
    process.env.QUEUE_DEAD_LETTER_SUFFIX = '__dlq';
  });

  it('computes per-queue DLQ name when enabled', () => {
    expect(getDeadLetterQueueName('heal_url')).toBe('heal_url__dlq');
  });

  it('returns null when disabled', () => {
    process.env.QUEUE_DEAD_LETTER_ENABLED = '0';
    expect(getDeadLetterQueueName('heal_url')).toBeNull();
  });

  it('returns null for DLQ queue itself (no nested dlq)', () => {
    expect(getDeadLetterQueueName('heal_url__dlq')).toBeNull();
  });

  it('ensureQueue creates main queue with deadLetter and also creates the DLQ queue', async () => {
    const createQueue = vi.fn(async () => undefined);
    const boss = { createQueue };

    (globalThis as any).__pixivcatQueue = {
      boss,
      starting: null,
      startError: null,
    };

    const returned = await ensureQueue('heal_url');

    expect(returned).toBe(boss);
    expect(createQueue).toHaveBeenNthCalledWith(1, 'heal_url', { deadLetter: 'heal_url__dlq' });
    expect(createQueue).toHaveBeenNthCalledWith(2, 'heal_url__dlq');
  });
});

