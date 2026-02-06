# Final Regression Sweep (2026-02-06_21-01-10)

## Commands Executed
1. `npm run test:all`
2. `pwsh -NoProfile -File test/proxy-smoke.ps1 -BaseUrl http://127.0.0.1:3015`
3. `pwsh -NoProfile -File test/admin-ui-smoke.ps1 -BaseUrl http://127.0.0.1:3015`
4. `docker compose up -d`
5. `docker info` (blocker diagnosis)
6. `docker compose -f docker-compose.yml config --services` (fallback structure check)

## Results
- `npm run test:all`: pass
  - lint: pass (2 warnings in `docs/review/admin-auth-proxy.cjs`, no errors)
  - vitest: `90 files / 425 tests passed`
  - smoke suite: `1 file / 2 tests passed`
- `proxy-smoke.ps1`: pass
  - `/healthz=503` (dependency degraded)
  - `/metrics` includes `pixivcat_up/http_requests_total/outbound_errors_total`
  - random contract degraded path asserted
- `admin-ui-smoke.ps1`: pass (degraded mode)
  - `ADMIN_TOKEN` missing in current shell, verified `/admin` remains protected (`401`)
  - authenticated page traversal skipped by script design
- `docker compose up -d`: blocked (timeout)
- `docker info`: blocked (timeout)
- `docker compose config --services`: pass (`memcached`, `postgres`, `migrate`, `backend`)

## Conclusion
- Regression scope is green for test/smoke contracts and degraded runtime paths.
- Deployment start validation is **blocked** by Docker daemon unavailability in current environment.
- Compose file structure remains valid; run `docker compose up -d` on a host with available daemon for final deploy acceptance.
