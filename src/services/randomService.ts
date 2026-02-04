import type { Readable } from 'node:stream';

import { generateRandomKey } from '../domain/randomKey';
import { getByIdWithTags, IMAGE_STATUS_BROKEN, markFail, pickRandom, type PickRandomDebug, type PickRandomFilters } from '../repositories/imagesRepo';
import { fetchPixivImageStream } from '../http/pixivImageHttp';
import { incrementUpstreamError } from '../metrics/upstreamMetrics';
import { classifyOutboundError } from '../resilience/outboundErrors';
import { enqueueHealUrl } from '../jobs/healUrl';

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
  const maxFetchRetries = 2;

  for (let i = 1; i <= maxAttempts; i += 1) {
    const r = generateRandomKey(random);
    const image = await pickRandom(filters, r);
    if (!image) return null;

    const originUrl = String(image.originalUrl || '');
    if (!originUrl) return null;

    try {
      let upstream: any;
      for (let fetchAttempt = 0; fetchAttempt <= maxFetchRetries; fetchAttempt += 1) {
        try {
          upstream = await fetchPixivImageStream(originUrl, signal);
          break;
        } catch (err: unknown) {
          if (signal.aborted) throw err;

          const anyErr = err as any;
          if (anyErr?.code === 'ERR_CANCELED') throw err;

          const usedProxy = Boolean(anyErr?.config?.__pixivcat_usedProxy);
          const classification = classifyOutboundError(err, { usedProxy });
          const status = classification.status ?? Number(anyErr?.response?.status);
          const terminal = Number.isFinite(status) && (status === 403 || status === 404);
          const canRetry = classification.retryable && !terminal;

          if (!canRetry || fetchAttempt >= maxFetchRetries) {
            throw err;
          }
        }
      }

      if (!upstream) {
        throw new Error('Image fetch failed without an error.');
      }
      return { image, originUrl, stream: upstream.data, attemptsUsed: i };
    } catch (err: unknown) {
      if (signal.aborted) return null;

      const anyErr = err as any;
      if (anyErr?.code === 'ERR_CANCELED') return null;

      const usedProxy = Boolean(anyErr?.config?.__pixivcat_usedProxy);
      const classification = classifyOutboundError(err, { usedProxy });
      const status = classification.status ?? Number(anyErr?.response?.status);
      if (Number.isFinite(status) && status === 429) incrementUpstreamError('rate_limit');
      else if (Number.isFinite(status) && status === 403) incrementUpstreamError('403');
      else if (Number.isFinite(status) && status === 404) incrementUpstreamError('404');
      else if (Number.isFinite(status) && status >= 500) incrementUpstreamError('5xx');
      else incrementUpstreamError('network');

      const code = Number.isFinite(status) && status > 0
        ? `${classification.type}_${status}`
        : typeof anyErr?.code === 'string' && anyErr.code
          ? anyErr.code
          : classification.type;
      const message = anyErr instanceof Error ? anyErr.message : typeof anyErr?.message === 'string' ? anyErr.message : String(anyErr);

      await markFail({
        id: image.id,
        errorCode: code,
        errorMsg: message,
        status: status === 403 || status === 404 ? IMAGE_STATUS_BROKEN : undefined,
      });

      if (status === 403 || status === 404) {
        try {
          await enqueueHealUrl(image.illustId);
        } catch {
          // best-effort
        }
      }
    }
  }

  return null;
}
