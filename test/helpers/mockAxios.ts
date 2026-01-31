import type { Readable } from 'node:stream';

export type MockAxiosStreamResponse = {
  data: Readable;
  status: number;
  headers: Record<string, string>;
};

export function mockAxiosStreamResponse(
  data: Readable,
  opts?: { status?: number; headers?: Record<string, string> },
): MockAxiosStreamResponse {
  return {
    data,
    status: opts?.status ?? 200,
    headers: opts?.headers ?? {},
  };
}

