import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPixivApiCircuit, isCircuitOpenError, pixivApiCircuitFire, resetPixivApiCircuitForTest } from '../src/resilience/circuit';

function setCircuitEnv(overrides: Record<string, string>): void {
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

function clearCircuitEnv(): void {
  delete process.env.PIXIV_CIRCUIT_ENABLED;
  delete process.env.PIXIV_CIRCUIT_TIMEOUT_MS;
  delete process.env.PIXIV_CIRCUIT_RESET_TIMEOUT_MS;
  delete process.env.PIXIV_CIRCUIT_ERROR_THRESHOLD_PERCENT;
  delete process.env.PIXIV_CIRCUIT_VOLUME_THRESHOLD;
  delete process.env.PIXIV_CIRCUIT_ROLLING_COUNT_TIMEOUT_MS;
  delete process.env.PIXIV_CIRCUIT_ROLLING_COUNT_BUCKETS;
}

describe('pixiv circuit breaker (opossum)', () => {
  beforeEach(() => {
    resetPixivApiCircuitForTest();
    clearCircuitEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetPixivApiCircuitForTest();
    clearCircuitEnv();
  });

  it('opens on failures, fast-fails while open, then recovers via half-open', async () => {
    vi.useFakeTimers();

    setCircuitEnv({
      PIXIV_CIRCUIT_VOLUME_THRESHOLD: '1',
      PIXIV_CIRCUIT_ERROR_THRESHOLD_PERCENT: '50',
      PIXIV_CIRCUIT_RESET_TIMEOUT_MS: '50',
      PIXIV_CIRCUIT_TIMEOUT_MS: '10',
    });

    const failOnce = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(pixivApiCircuitFire(failOnce)).rejects.toMatchObject({ message: 'boom' });

    const breaker = getPixivApiCircuit();
    expect(breaker.opened).toBe(true);

    const openErr = await pixivApiCircuitFire(async () => 'ok').catch((err) => err);
    expect(isCircuitOpenError(openErr)).toBe(true);

    await vi.advanceTimersByTimeAsync(60);

    await expect(pixivApiCircuitFire(async () => 'recovered')).resolves.toBe('recovered');
    expect(breaker.closed).toBe(true);
  });
});

