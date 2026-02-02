# Compliance / Policy Notes

This project provides a “random anime image” API on top of Pixiv original image URLs.

## Copyright / Terms
- Images are owned by their respective creators. This project does not grant any license to re-upload or redistribute copyrighted works.
- This service is designed to **proxy** content and keep metadata needed for filtering/operation; it is not a “content ownership transfer”.
- Operators should review Pixiv Terms of Service and local laws before running this service publicly.

## R18 Policy (default)
- Default behavior is **all-ages only**:
  - `/random` defaults to `r18=0`
  - R18 (`r18=1`) and R18G (`r18=2`) require explicit user input and should be gated appropriately.
- Operators should implement additional access control (auth, IP allowlist, private deployment) if enabling adult content.

## Takedown / Disable / Removal Process
Goal: provide a fast and auditable way to remove content from selection.

### Immediate disable (recommended)
Disable an image by setting `status=disabled`. Disabled images are not eligible for `/random` selection (active-only pick).

Options:
- AdminJS UI: Images record action “Disable” / “Delete (soft)”.
- Admin API (requires `ADMIN_TOKEN`):
  - `POST /admin/images/<id>/disable`
  - `POST /admin/images/<id>/delete` (soft delete → disabled)

Expected result:
- The image remains in DB for auditability, but is removed from the active pool.
- The change is written to the Admin Audit log (see “Audit & Traceability”).

### Cache considerations
- `/random` responses are `Cache-Control: no-store` and should not be cached.
- Stable URLs (`/i/:id.:ext`) use long cache headers; if a takedown must be immediate, operators may need to purge CDN caches for affected `/i/*` paths.

## Audit & Traceability
- Admin actions should be auditable:
  - Import operations create records in `imports`
  - Status changes are recorded via `admin_audit` (see `src/audit/adminAudit.ts`)
- For investigations, use:
  - Request correlation: `X-Request-Id` / `request_id` in logs
  - Admin audit records: `admin_audit` table entries with `record_id`, `from_status`, `to_status`

## Token / Credential Safety
- Pixiv refresh tokens are provided via `REFRESH_TOKENS` (environment variable).
- Never log refresh tokens or access tokens:
  - HTTP client headers are masked (see `src/services/pixivAuthService.*` and `maskHeader`)
- Secrets should be stored and managed securely:
  - Avoid committing `.env` to source control
  - Prefer platform secret managers (CI secrets, container secrets, etc.)

## Logging / Data Minimization
- Logs are structured (pino) and include `request_id`.
- Operators should avoid storing:
  - Full original image URLs in logs (can contain identifiers)
  - Any token-bearing headers or query params

## Practical checks (operator-run)
- Verify default all-ages:
  - `GET /random` should behave as `r18=0`
- Verify takedown path:
  - Disable a known image via admin UI/API
  - Confirm it no longer appears in `/random` results (with enough attempts/seed)

