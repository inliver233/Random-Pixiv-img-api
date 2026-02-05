import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isOpportunisticHydrateCandidate,
  resetOpportunisticHydrateStateForTest,
  scheduleOpportunisticHydrate,
} from '../src/hydration/opportunisticHydrate';

afterEach(() => {
  resetOpportunisticHydrateStateForTest();
  vi.restoreAllMocks();
});

describe('opportunistic hydrate', () => {
  it('detects metadata-missing candidates', () => {
    expect(isOpportunisticHydrateCandidate({ width: null, height: 100 })).toBe(true);
    expect(isOpportunisticHydrateCandidate({ width: 100, height: null })).toBe(true);
    expect(isOpportunisticHydrateCandidate({ width: 100, height: 100, userId: null, userName: 'u' })).toBe(true);
    expect(isOpportunisticHydrateCandidate({ width: 100, height: 100, userId: 1n, userName: null })).toBe(true);
    expect(isOpportunisticHydrateCandidate({ width: 100, height: 100, userId: 1n, userName: 'u', title: null })).toBe(true);
    expect(isOpportunisticHydrateCandidate({ width: 100, height: 100, userId: 1n, userName: 'u', title: 't', createdAtPixiv: null })).toBe(true);
    expect(isOpportunisticHydrateCandidate({ width: 100, height: 100, userId: 1n, userName: 'u', title: 't', createdAtPixiv: new Date(), xRestrict: null })).toBe(true);

    expect(isOpportunisticHydrateCandidate({
      width: 100,
      height: 100,
      userId: 1n,
      userName: 'u',
      title: 't',
      createdAtPixiv: new Date(),
      xRestrict: 0,
    })).toBe(false);
  });

  it('skips when policy is disabled', async () => {
    const enqueue = vi.fn(async () => 'job-1');

    const res = await scheduleOpportunisticHydrate(
      { illustId: 1n, requestId: 'req-1' },
      {
        now: () => 1000,
        getRuntimeConfig: async () => ({ opportunisticHydrate: false }),
        enqueueHydrate: enqueue,
      },
    );

    expect(res).toEqual({ scheduled: false, reason: 'disabled' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not await enqueue (fire-and-forget)', async () => {
    const pending = new Promise<string>(() => undefined);
    const enqueue = vi.fn(() => pending);

    const res = await scheduleOpportunisticHydrate(
      { illustId: 123n, requestId: 'req-oppo-1' },
      {
        now: () => 1000,
        getRuntimeConfig: async () => ({ opportunisticHydrate: true }),
        enqueueHydrate: enqueue,
      },
    );

    expect(res).toEqual({ scheduled: true, reason: 'scheduled' });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(123n, 'req-oppo-1');
  });

  it('dedupes by illust id within ttl', async () => {
    const enqueue = vi.fn(async () => 'job-1');
    const deps = {
      now: () => 1000,
      getRuntimeConfig: async () => ({ opportunisticHydrate: true }),
      enqueueHydrate: enqueue,
      dedupeTtlMs: 60_000,
      windowMs: 60_000,
      maxPerWindow: 10,
    };

    const first = await scheduleOpportunisticHydrate({ illustId: 1n }, deps);
    const second = await scheduleOpportunisticHydrate({ illustId: 1n }, deps);

    expect(first).toEqual({ scheduled: true, reason: 'scheduled' });
    expect(second).toEqual({ scheduled: false, reason: 'deduped' });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('limits max schedules per window', async () => {
    const enqueue = vi.fn(async () => 'job-1');
    const deps = {
      now: () => 1000,
      getRuntimeConfig: async () => ({ opportunisticHydrate: true }),
      enqueueHydrate: enqueue,
      dedupeTtlMs: 0,
      windowMs: 60_000,
      maxPerWindow: 1,
    };

    const first = await scheduleOpportunisticHydrate({ illustId: 1n }, deps);
    const second = await scheduleOpportunisticHydrate({ illustId: 2n }, deps);

    expect(first).toEqual({ scheduled: true, reason: 'scheduled' });
    expect(second).toEqual({ scheduled: false, reason: 'rate_limited' });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

