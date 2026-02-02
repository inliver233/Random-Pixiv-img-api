import { performance } from 'node:perf_hooks';

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, idx))];
}

async function main() {
  const url = process.argv[2] || 'http://127.0.0.1:3000/random?redirect=1';
  const durationMs = Number(process.env.DURATION_MS || 20_000);
  const concurrency = Number(process.env.CONCURRENCY || 50);

  if (!Number.isFinite(durationMs) || durationMs < 1000) {
    throw new Error('Invalid DURATION_MS (>= 1000).');
  }
  if (!Number.isFinite(concurrency) || concurrency < 1 || concurrency > 500) {
    throw new Error('Invalid CONCURRENCY (1..500).');
  }

  const endAt = Date.now() + durationMs;

  let total = 0;
  let ok = 0;
  let redirects = 0;
  let errors = 0;
  const latenciesMs = [];

  async function worker() {
    while (Date.now() < endAt) {
      const start = performance.now();
      try {
        const res = await fetch(url, { redirect: 'manual' });
        if (res.status >= 200 && res.status < 400) ok += 1;
        if (res.status === 302) redirects += 1;
        // Consume body (even though 302 is usually empty) to keep the client honest.
        await res.arrayBuffer().catch(() => {});
      } catch {
        errors += 1;
      } finally {
        total += 1;
        latenciesMs.push(performance.now() - start);
      }
    }
  }

  const startedAt = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = performance.now() - startedAt;

  latenciesMs.sort((a, b) => a - b);

  const qps = (total / elapsedMs) * 1000;
  const p50 = percentile(latenciesMs, 50);
  const p90 = percentile(latenciesMs, 90);
  const p95 = percentile(latenciesMs, 95);
  const p99 = percentile(latenciesMs, 99);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    url,
    duration_ms: Math.round(elapsedMs),
    concurrency,
    total,
    ok,
    redirects_302: redirects,
    errors,
    qps: Number.isFinite(qps) ? Number(qps.toFixed(1)) : null,
    latency_ms: {
      p50: p50 ? Number(p50.toFixed(1)) : null,
      p90: p90 ? Number(p90.toFixed(1)) : null,
      p95: p95 ? Number(p95.toFixed(1)) : null,
      p99: p99 ? Number(p99.toFixed(1)) : null,
    },
  }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

