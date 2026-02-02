# RAPI-0165 — Admin Checklist: Imports Audit View

Purpose: manual acceptance checklist for viewing import/audit records related to image imports.

## Preconditions
- Server is running (`npm run build && npm run start:prod`) or equivalent.
- `ADMIN_TOKEN` is configured and known.
- `DATABASE_URL` points to a Postgres database.
- At least one import record exists in DB (`imports` table).
  - You can create one by calling `POST /admin/images/import` with a small textarea payload.

## Access
1. Open `GET /admin` in a browser.
2. Authenticate using `Authorization: Bearer <ADMIN_TOKEN>` or `GET /admin?token=<ADMIN_TOKEN>`.
3. Navigate to the **Imports** (or equivalent) resource list.

Expected:
- Resource list loads without errors.
- Recent import records are visible, ordered by time (or clearly sortable).

## List view checks
1. Confirm basic fields render:
   - `id`, `createdAt`, `source`, `total`, `success`, `failed`
2. Confirm the “detail” field (if present) is viewable in record show view.

Expected:
- Counts match the actual import submission.
- `detail` contains useful breakdown (deduped/unique/errors sample) when available.

## Record show view checks
1. Open a single import record.
2. Confirm all fields are present and readable:
   - `source`, `total`, `success`, `failed`, `createdAt`, `detail`
3. If error samples exist, confirm they are readable (line/url/code/message).

Expected:
- No crash when rendering JSON detail.
- Large `detail` payloads do not break the UI (may truncate but stays usable).

## Negative / edge cases
1. No imports in DB
   - Expected: empty list UI is still usable (no crash).

2. Malformed `detail` (if DB contains unexpected JSON)
   - Expected: show view still renders and does not break the Admin UI.

3. Unauthorized access
   - Missing/wrong token => `401`.

## Notes to capture during execution
- Which import record IDs were inspected.
- Any UI limitations for large JSON fields.
- Performance observations (slow list, slow record show).

