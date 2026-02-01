import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAxiosRetry = vi.hoisted(() => {
  const fn: any = vi.fn();
  fn.exponentialDelay = vi.fn();
  fn.isNetworkOrIdempotentRequestError = vi.fn(() => false);
  return fn;
});

vi.mock('axios-retry', () => ({
  default: mockAxiosRetry,
}));

describe('axiosClient axios-retry config', () => {
  beforeEach(() => {
    vi.resetModules();
    mockAxiosRetry.mockClear();
    mockAxiosRetry.exponentialDelay.mockClear();
    mockAxiosRetry.isNetworkOrIdempotentRequestError.mockClear();
  });

  it('configures exponential backoff + guarded retryCondition', async () => {
    await import('../src/http/axiosClient');

    expect(mockAxiosRetry).toHaveBeenCalledTimes(1);

    const options = mockAxiosRetry.mock.calls[0]?.[1] as any;
    expect(options).toMatchObject({
      retries: 2,
      shouldResetTimeout: true,
      retryDelay: mockAxiosRetry.exponentialDelay,
    });

    expect(options.retryCondition({ config: { responseType: 'stream' } })).toBe(false);
    expect(options.retryCondition({ code: 'ECONNABORTED', config: {} })).toBe(true);

    mockAxiosRetry.isNetworkOrIdempotentRequestError.mockReturnValueOnce(true);
    expect(options.retryCondition({ config: {} })).toBe(true);
    expect(mockAxiosRetry.isNetworkOrIdempotentRequestError).toHaveBeenCalled();
  });
});

