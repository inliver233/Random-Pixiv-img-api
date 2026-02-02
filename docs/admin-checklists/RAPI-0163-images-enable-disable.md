# RAPI-0163 — Admin Checklist: Images Enable / Disable

Purpose: manual acceptance checklist for enabling/disabling images in the AdminJS “Images” resource.

## Preconditions
- Server is running (`npm run build && npm run start:prod`) or equivalent.
- `ADMIN_TOKEN` is configured and known.
- `DATABASE_URL` points to a seeded Postgres database.
- At least:
  - One `images` row with `status=active`
  - One `images` row with `status=disabled`

## Access
1. Open `GET /admin` in a browser.
2. Authenticate using `Authorization: Bearer <ADMIN_TOKEN>` or `GET /admin?token=<ADMIN_TOKEN>`.
3. Navigate to **Images** list.

Expected:
- Images list loads.
- Per-record actions are visible according to the current `status`.

## Disable flow
1. Pick an **active** image record.
2. Trigger the record action **Disable**.
3. Confirm the guard/confirmation if prompted.
4. Return to the record view / list.

Expected:
- The record `status` becomes `disabled`.
- The **Disable** action is no longer visible for this record; **Enable** becomes visible.
- `/random` no longer selects this image (optional spot-check if DB is seeded and /random is enabled).

## Enable flow
1. Pick a **disabled** image record.
2. Trigger the record action **Enable**.
3. Confirm the guard/confirmation if prompted.
4. Return to the record view / list.

Expected:
- The record `status` becomes `active`.
- **Enable** is no longer visible; **Disable** becomes visible.

## API verification (optional)
If using API endpoints instead of AdminJS UI:
- `POST /admin/images/<id>/disable`
- `POST /admin/images/<id>/enable`

Expected:
- Returns `200` JSON `{ ok:true, id, from_status, to_status, status }`
- Unauthorized requests return `401`.

## Negative / edge cases
1. Unauthorized access
   - Open Admin without token or with wrong token.
   - Expected: `401` and no state changes.

2. Invalid ID
   - Call `POST /admin/images/abc/disable`
   - Expected: `400` with a clear error code.

3. Non-existent ID
   - Call `POST /admin/images/999999/disable`
   - Expected: `404` (not found).

## Notes to capture during execution
- Which record IDs were toggled.
- Whether UI refresh is required to see the new status.
- Any audit log visibility (if Admin Audit view is enabled).

