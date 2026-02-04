export type RetryOptions = {
  retries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  factor?: number;
  sleep?: (ms: number) => Promise<void>;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; err: unknown }) => void;
};

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computeExponentialBackoffDelayMs(params: {
  attempt: number;
  baseDelayMs: number;
  factor?: number;
  maxDelayMs?: number;
}): number {
  const attempt = Math.max(0, Math.trunc(params.attempt));
  const base = Math.max(0, Math.trunc(params.baseDelayMs));
  const factor = params.factor ?? 2;
  const maxDelayMs = params.maxDelayMs ?? Number.POSITIVE_INFINITY;

  const raw = Math.trunc(base * Math.pow(factor, attempt));
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(raw, maxDelayMs);
}

export async function retryWithBackoff<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const retries = Math.max(0, Math.trunc(options.retries));
  const baseDelayMs = Math.max(0, Math.trunc(options.baseDelayMs));
  const factor = options.factor ?? 2;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? sleepMs;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      // attempt=0 is the initial try, 1..retries are retry attempts.
      return await fn(attempt);
    } catch (err: unknown) {
      lastErr = err;
      if (attempt >= retries) break;
      if (!shouldRetry(err, attempt)) break;

      const delayMs = computeExponentialBackoffDelayMs({ attempt, baseDelayMs, factor, maxDelayMs });
      options.onRetry?.({ attempt, delayMs, err });
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  throw lastErr;
}

