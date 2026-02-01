import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAxiosGet = vi.hoisted(() => vi.fn());
const mockAxiosRequest = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    get: mockAxiosGet,
    request: mockAxiosRequest,
  },
}));

import { pixivApiGet, pixivApiRequest, pixivImageGet } from '../src/http/axiosClient';

describe('axiosClient', () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockAxiosRequest.mockReset();
  });

  it('pixivApiGet sets keep-alive agents and timeout', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { ok: true } } as any);

    await pixivApiGet('https://example.invalid/api', { headers: { 'X-Test': '1' } });

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://example.invalid/api',
      expect.objectContaining({
        timeout: 10_000,
        httpAgent: expect.any(Object),
        httpsAgent: expect.any(Object),
        maxContentLength: 2 * 1024 * 1024,
        maxBodyLength: 2 * 1024 * 1024,
        headers: expect.objectContaining({ 'X-Test': '1' }),
      }),
    );
  });

  it('pixivApiRequest passes through method/url/data and keeps defaults', async () => {
    mockAxiosRequest.mockResolvedValueOnce({ data: { ok: true } } as any);

    await pixivApiRequest({
      method: 'post',
      url: 'https://example.invalid/post',
      data: { hello: 'world' },
    });

    expect(mockAxiosRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'post',
        url: 'https://example.invalid/post',
        data: { hello: 'world' },
        timeout: 10_000,
        httpAgent: expect.any(Object),
        httpsAgent: expect.any(Object),
      }),
    );
  });

  it('pixivImageGet uses larger size limit defaults', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { ok: true } } as any);

    await pixivImageGet('https://example.invalid/image', { responseType: 'stream' } as any);

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://example.invalid/image',
      expect.objectContaining({
        timeout: 20_000,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
        httpAgent: expect.any(Object),
        httpsAgent: expect.any(Object),
        responseType: 'stream',
      }),
    );
  });
});

