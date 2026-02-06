# Final Regression (DOPT) - 2026-02-06_22-05-56

## Commands
1. `npm run test:all`
2. `pwsh -NoProfile -File test/proxy-smoke.ps1 -BaseUrl http://127.0.0.1:3015`
3. `pwsh -NoProfile -File test/admin-ui-smoke.ps1 -BaseUrl http://127.0.0.1:3015`
4. `pwsh -NoProfile -File test/admin-ui-smoke.ps1 -BaseUrl http://127.0.0.1:3015 -RequireAuthChecks`
5. `docker compose up -d`
6. `docker info`
7. `docker compose -f docker-compose.yml config --services`

## Results
- `npm run test:all`: PASS
  - lint: pass
  - vitest: `91 files / 428 tests passed`
  - smoke suite: pass
- `proxy-smoke.ps1`: PASS (degraded dependency path expected; metrics contract intact)
- `admin-ui-smoke.ps1`: PASS in degraded mode (`ADMIN_TOKEN` missing -> protected endpoint check)
- `admin-ui-smoke.ps1 -RequireAuthChecks`: EXPECTED FAIL (exit 1, fail-fast gate works)
- `docker compose up -d`: BLOCKED (timeout)
- `docker info`: BLOCKED (timeout)
- `docker compose config --services`: PASS (`memcached`, `postgres`, `migrate`, `backend`)

## Conclusion
- Functional/test regression is green after deep optimization updates.
- Strict admin smoke gate is now effective and prevents token-missing false positives.
- Compose runtime startup remains blocked in current shell due unavailable Docker daemon; structure-level validation still passes.
