# Deep Optimization Documentation Check (2026-02-06_21-55-30)

## Updated docs
- `README.md`
- `test/README.md`

## Added/clarified items
- Added strict admin smoke command (`smoke:admin-ui:strict`) for release gates.
- Clarified runtime module resolution behavior in `app.ts`:
  - source runtime -> `.ts`
  - `dist` runtime -> `.js`
- Clarified that strict smoke fails fast when `ADMIN_TOKEN` is missing.
- Kept `validation_limited` wording for docker-daemon restricted environments.

## Quick verification
- `rg -n "RequireAuthChecks|runtime module|test:runtime-regression|validation_limited|smoke:admin-ui:strict" README.md test/README.md docs/review -g "*.md"`
