import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPickRandom = vi.hoisted(() => vi.fn());
const mockMarkFail = vi.hoisted(() => vi.fn(async () => ({})));
const mockFetchPixivImageStream = vi.hoisted(() => vi.fn());
const mockEnqueueHealUrl = vi.hoisted(() => vi.fn(async () => 'job1'));
const mockIncrementUpstreamError = vi.hoisted(() => vi.fn());

vi.mock('../src/repositories/imagesRepo', () => ({
  IMAGE_STATUS_BROKEN: 3,
  getByIdWithTags: vi.fn(),
  markFail: mockMarkFail,
  pickRandom: mockPickRandom,
}));

vi.mock('../src/http/pixivImageHttp', () => ({
  fetchPixivImageStream: mockFetchPixivImageStream,
}));

vi.mock('../src/jobs/healUrl', () => ({
  enqueueHealUrl: mockEnqueueHealUrl,
}));

vi.mock('../src/metrics/upstreamMetrics', () => ({
  incrementUpstreamError: mockIncrementUpstreamError,
}));

import { pickRandomImageStream } from '../src/services/randomService';

describe('pickRandomImageStream image fetch retry + broken cooldown', () => {
  const image = {
    id: BigInt(1),
    illustId: BigInt(123),
    originalUrl: 'https://i.pximg.net/img-original/img/2026/02/01/00/00/00/123_p0.jpg',
  };

  beforeEach(() => {
    mockPickRandom.mockReset();
    mockMarkFail.mockReset();
    mockFetchPixivImageStream.mockReset();
    mockEnqueueHealUrl.mockReset();
    mockIncrementUpstreamError.mockReset();
    mockPickRandom.mockResolvedValue(image);
  });

  it('retries fetch for retryable network errors and does not mark fail on success', async () => {
    mockFetchPixivImageStream
      .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'reset' })
      .mockResolvedValueOnce({ status: 200, data: Readable.from(['img']) });

    const ac = new AbortController();
    const result = await pickRandomImageStream({}, 1, ac.signal, () => 0.5);

    expect(result).not.toBeNull();
    expect(mockFetchPixivImageStream).toHaveBeenCalledTimes(2);
    expect(mockMarkFail).not.toHaveBeenCalled();
    expect(mockEnqueueHealUrl).not.toHaveBeenCalled();
  });

  it('marks broken + enqueues heal_url for 404 and does not retry', async () => {
    mockFetchPixivImageStream.mockRejectedValueOnce({
      response: { status: 404 },
      message: 'not found',
    });

    const ac = new AbortController();
    const result = await pickRandomImageStream({}, 1, ac.signal, () => 0.5);

    expect(result).toBeNull();
    expect(mockFetchPixivImageStream).toHaveBeenCalledTimes(1);
    expect(mockMarkFail).toHaveBeenCalledTimes(1);

    const markFailArg = mockMarkFail.mock.calls[0]?.[0];
    expect(markFailArg).toMatchObject({
      id: image.id,
      status: 3,
      errorCode: 'upstream_404',
    });

    expect(mockEnqueueHealUrl).toHaveBeenCalledTimes(1);
    expect(mockEnqueueHealUrl.mock.calls[0]?.[0]).toBe(image.illustId);
  });

  it('does not loop forever when retryable errors persist', async () => {
    mockFetchPixivImageStream.mockRejectedValue({ code: 'ECONNRESET', message: 'reset' });

    const ac = new AbortController();
    const result = await pickRandomImageStream({}, 1, ac.signal, () => 0.5);

    expect(result).toBeNull();
    expect(mockFetchPixivImageStream).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(mockMarkFail).toHaveBeenCalledTimes(1);
  });
});

