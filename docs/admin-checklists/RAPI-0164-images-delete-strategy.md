# RAPI-0164 — Admin Checklist: Images Delete Strategy (Soft Delete)

Purpose: manual acceptance checklist for the AdminJS “Images” resource delete behavior (soft delete preferred).

## Preconditions
- Server is running (`npm run build && npm run start:prod`) or equivalent.
- `ADMIN_TOKEN` is configured and known.
- `DATABASE_URL` points to a seeded Postgres database.
- At least one `images` row with `status=active`.

## Expected delete strategy (current MVP)
- Delete is **soft delete**: the record remains in DB but becomes **disabled** (`status=disabled`).
- Deleted/disabled images must not be selected by `/random` (active-only pick).

## Access
1. Open `GET /admin` in a browser.
2. Authenticate using `Authorization: Bearer <ADMIN_TOKEN>` or `GET /admin?token=<ADMIN_TOKEN>`.
3. Navigate to **Images** list.

## Soft delete flow (AdminJS UI)
1. Pick an **active** image record.
2. Trigger the record action **Delete**.
3. Confirm the guard/confirmation text.
4. Return to the record view / list.

Expected:
- Record remains accessible (not physically removed).
- Record `status` becomes `disabled`.
- Record no longer appears in the default “active-only” paths (e.g., `/random` pick).
- UI actions reflect the new state (Delete may hide when already disabled).

## API flow (optional)
If using API endpoints instead of AdminJS UI:
- `POST /admin/images/<id>/delete`

Expected:
- Returns `200` JSON `{ ok:true, id, from_status, to_status, status }`
- Unauthorized requests return `401`.

## Negative / edge cases
1. Delete already-disabled record
   - Repeat delete on a disabled image.
   - Expected: should not crash; record remains disabled (document whether it is idempotent).

2. Invalid ID / Not Found
   - `POST /admin/images/abc/delete` => `400`
   - `POST /admin/images/999999/delete` => `404`

3. Unauthorized
   - Missing/incorrect token => `401` and no state changes.

## Notes to capture during execution
- Which record IDs were deleted.
- Whether audit logs record the status change (if Admin Audit view is enabled).
- Whether delete is idempotent and what response is returned.

