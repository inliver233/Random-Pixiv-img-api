# /random?redirect=1 perf smoke

Goal: establish a lightweight, repeatable baseline for `/random?redirect=1` on a low-spec machine.

Why `redirect=1`:
- It avoids proxying image bytes in-process.
- It exercises the DB "pick random" path + redirect response path.

## Prereqs
- Server running locally (example): `npm run start:prod`
- DB seeded with enough images to satisfy `/random` filters.

## Run (no dependencies)
This repo includes a simple Node.js load script:

```powershell
$env:CONCURRENCY="50"
$env:DURATION_MS="20000"
node scripts/perf_random_redirect_smoke.mjs "http://127.0.0.1:3000/random?redirect=1"
```

It prints JSON with QPS + latency percentiles.

## Suggested baseline / thresholds (guide)
- `errors` == 0
- `redirects_302 / total` > 0.99
- Track `qps`, `latency_ms.p95` between releases (regressions > 2x require investigation)

## Notes
- If `/random` returns 404 (no match), seed more images or relax filters.
- If you deploy behind a reverse proxy, run the same command against the public endpoint as a second baseline.

