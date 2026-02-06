# Documentation & Deployment Audit (2026-02-06_20-45-30)

## Scope
- `README.md`
- `docs/usage/easy-proxies-integration.md`
- `docs/deployment/security-checklist.md`

## Changes Landed
- Added explicit one-line URI import operator guide (raw `@` and `%40` password forms).
- Added line-level validation feedback expectations (`line + error`) and conflict policy guidance (`skip_non_source`).
- Added runtime evidence links for Admin UI fixes and easy_proxies import screenshots.
- Added repeatable regression command set (`test:admin-runtime`, `test:runtime-regression`, `smoke:admin-ui`).
- Added compose restricted-environment rule (`validation_limited`) and daemonless structure-check workflow.

## Verification Commands
1. `rg -n "line=|%40|skip_non_source|validation_limited|docker compose -f docker-compose.yml config --services|smoke:admin-ui|未指定组件|imported / invalid / conflicts" README.md docs/usage/easy-proxies-integration.md docs/deployment/security-checklist.md`
2. `docker compose -f docker-compose.yml config --services`

## Verification Results
- Keyword grep: pass (all required keywords found in the three updated docs).
- Compose service validation: pass.
  - Output services: `postgres`, `migrate`, `memcached`, `backend`.
  - Note: order may differ by compose implementation; required set is complete.

## Runtime Evidence References
- `docs/review/2026-02-06_18-44-05-admin-ui-runtime-findings.md`
- `docs/review/screenshots/2026-02-06_19-14-04/arux-0004-easy-import-summary.png`
- `docs/review/screenshots/2026-02-06_19-14-04/arux-0005-dashboard-unified.png`
