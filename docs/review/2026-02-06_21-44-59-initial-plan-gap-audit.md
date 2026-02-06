# Initial Plan Gap Audit (2026-02-06_21-44-59)

## Sources Reviewed
- `E:\pixiv-download-修改版本\最初计划.txt`
- `随机api开发规划.md`
- Core implementation paths (`app.ts`, `src/routes/*.ts`, `src/admin/*`, `src/repositories/*`, `src/services/*`)
- Existing review evidence under `docs/review/2026-02-06_18-44-05-*`

## Baseline Verification
- Command: `npm run test:all`
- Result: pass (`90` test files / `425` tests + smoke)
- Note: lint has 2 warnings from local review helper file `docs/review/admin-auth-proxy.cjs` (not product code, but creates CI noise)

## Requirement Coverage Matrix (from original plan)

| Original requirement | Current implementation evidence | Status |
|---|---|---|
| Random API default returns image | `src/routes/random.ts` streams image by default | DONE |
| Random API supports JSON mode | `src/routes/random.ts` + `src/contracts/randomResponse.ts` | DONE |
| Filters: orientation/size/r18/tag/author/illust | `src/routes/random.ts` parser + `src/repositories/imagesRepo.ts` query filters | DONE |
| Retry/fallback robustness instead of direct error | `src/services/randomService.ts` `pickRandomImageStream` attempts + fail marking | DONE |
| Admin hot update without restart | `/admin/images/import`, runtime cache invalidation (`src/config/runtimeConfig.ts`) | DONE |
| Admin visibility: metrics/statistics | dashboard metrics + Prometheus aggregation in `src/admin/adminJs.ts` and `src/admin/pages/dashboard.jsx` | DONE |
| Legacy proxy compatibility preserved | `src/routes/pixivRoutes.ts` + contract tests `test/legacyRoutesContract.test.ts` | DONE |
| Stability/observability (`/healthz`, `/metrics`) | `src/routes/healthz.ts`, `src/routes/metrics.ts`, related tests | DONE |

## Deep Audit Findings (remaining quality gaps)

### G1 - Source runtime may load stale/incomplete CJS wrappers
- Current `app.ts` resolves route/middleware modules without extensions (`require('./src/routes/api')`), which resolves to `*.js` wrappers in source mode.
- Some wrappers delegate to `dist` if present (risk: stale code during dev), and some wrappers fall back to reduced behavior (e.g. `501 not_implemented` on missing dist).
- Impact: local runtime behavior can diverge from TS source and from tests, reducing maintainability/debuggability.

### G2 - Admin UI smoke defaults to degraded-success when token is missing
- `test/admin-ui-smoke.ps1` intentionally passes without token by only checking protected access.
- Good for bootstrap, but can hide authenticated-page regressions in CI or release checks if token injection fails silently.

### G3 - Lint noise from ad-hoc review scripts
- `eslint` scans `docs/review/admin-auth-proxy.cjs`; this file contains deliberate console logs.
- Not a product bug, but pollutes regression signal and can hide real warnings.

## Conclusion
- The original functional plan is now broadly implemented and exceeds MVP scope.
- Remaining work is mainly "deep quality hardening": runtime module-resolution correctness, stricter smoke gate for authenticated admin flows, and cleaner lint signal.
- These gaps are suitable for a focused final optimization cycle with small, verifiable issues.
