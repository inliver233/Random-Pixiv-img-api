import { describe, expect, it } from 'vitest';

import { runWithTimeout } from '../src/admin/utils/runWithTimeout';

describe('runWithTimeout', () => {
  it('returns ok when work resolves before timeout', async () => {
    const result = await runWithTimeout(Promise.resolve('ok'), 200);
    expect(result).toEqual({ status: 'ok', value: 'ok' });
  });

  it('returns timeout when work exceeds timeout window', async () => {
    const delayed = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 80);
    });
    const result = await runWithTimeout(delayed, 10);
    expect(result).toEqual({ status: 'timeout' });
  });

  it('returns error when work rejects', async () => {
    const result = await runWithTimeout(Promise.reject(new Error('probe failed')), 200);
    expect(result).toEqual({ status: 'error', error: 'probe failed' });
  });
});

