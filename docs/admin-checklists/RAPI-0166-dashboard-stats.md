# RAPI-0166 — Admin Checklist: Dashboard Stats

Purpose: manual acceptance checklist for AdminJS dashboard statistics.

## Preconditions
- Server is running (`npm run build && npm run start:prod`) or equivalent.
- `ADMIN_TOKEN` is configured and known.
- `DATABASE_URL` points to a seeded Postgres database.
- Seed should include enough rows to make stats meaningful:
  - Images: total/active/disabled/broken
  - Some `xRestrict` variety (0/1/2)

## Access
1. Open `GET /admin` in a browser.
2. Authenticate using `Authorization: Bearer <ADMIN_TOKEN>` or `GET /admin?token=<ADMIN_TOKEN>`.
3. Open the dashboard page (default landing page or “Dashboard” in the sidebar).

Expected:
- Dashboard renders without errors.
- No console errors or repeated failing network requests.

## Dashboard data checks
1. Confirm dashboard shows basic counters (or sections) such as:
   - Images total / active / disabled / broken
   - `xRestrict` distribution (all-ages / r18 / r18g / unknown)
2. Confirm values match DB reality (spot-check via SQL or Admin list filters).

Expected:
- Numbers are consistent with the DB and update after changes.

## Live update spot-check
1. Disable an active image (via Admin action or API).
2. Refresh dashboard.

Expected:
- Active decreases by 1, disabled increases by 1 (or similar, depending on the dashboard definition).

## Failure modes
1. No DB connection / DB error
   - Expected: dashboard shows a clear error state (“failed to load dashboard”) and does not crash the Admin UI.

2. Empty database
   - Expected: dashboard renders and shows zeros gracefully.

3. Unauthorized
   - Missing/wrong token => `401`.

## Notes to capture during execution
- Which dashboard sections are present.
- Any metrics semantics (e.g., whether broken counts include disabled).
- Performance observations (slow load, timeouts).

