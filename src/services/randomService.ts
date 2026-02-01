import type { Readable } from 'node:stream';

import { generateRandomKey } from '../domain/randomKey';
import { getByIdWithTags, IMAGE_STATUS_BROKEN, markFail, pickRandom, type PickRandomDebug, type PickRandomFilters } from '../repositories/imagesRepo';
import { fetchPixivImageStream } from '../http/pixivImageHttp';

export type RandomStreamResult = {
  image: any;
  originUrl: string;
  stream: Readable;
  attemptsUsed: number;
};

export type PickRandomImageRecordOptions = {
  withTags?: boolean;
  debug?: PickRandomDebug;
};

export async function pickRandomImageRecord(
  filters: PickRandomFilters,
  random: () => number = Math.random,
  options?: PickRandomImageRecordOptions,
) {
  const r = generateRandomKey(random);

  const debug = options?.debug;
  const image = await pickRandom(filters, r, debug ? { debug } : undefined);
  if (!image) return null;

  if (options?.withTags) {
    try {
      const full = await getByIdWithTags(image.id);
      if (full) return full;
    } catch {
      // best-effort
    }
  }

  return image;
}

export async function pickRandomImageStream(
  filters: PickRandomFilters,
  attempts: number,
  signal: AbortSignal,
  random: () => number = Math.random,
): Promise<RandomStreamResult | null> {
  const maxAttempts = Math.max(1, Math.min(10, attempts));

  for (let i = 1; i <= maxAttempts; i += 1) {
    const r = generateRandomKey(random);
    const image = await pickRandom(filters, r);
    if (!image) return null;

    const originUrl = String(image.originalUrl || '');
    if (!originUrl) return null;

    try {
      const upstream = await fetchPixivImageStream(originUrl, signal);
      return { image, originUrl, stream: upstream.data, attemptsUsed: i };
    } catch (err: unknown) {
      if (signal.aborted) return null;

      const anyErr = err as any;
      if (anyErr?.code === 'ERR_CANCELED') return null;

      const status = Number(anyErr?.response?.status);
      const code =
        Number.isFinite(status) && status > 0
          ? `upstream_${status}`
          : typeof anyErr?.code === 'string' && anyErr.code
            ? anyErr.code
            : 'upstream_error';
      const message = anyErr instanceof Error ? anyErr.message : typeof anyErr?.message === 'string' ? anyErr.message : String(anyErr);

      await markFail({
        id: image.id,
        errorCode: code,
        errorMsg: message,
        status: status === 403 || status === 404 ? IMAGE_STATUS_BROKEN : undefined,
      });
    }
  }

  return null;
}
