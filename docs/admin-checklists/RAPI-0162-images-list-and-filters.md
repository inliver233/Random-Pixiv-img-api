# RAPI-0162 — Admin Checklist: Images List & Filters

Purpose: manual acceptance checklist for the AdminJS “Images” resource list and its filter UI.

## Preconditions
- Server is running (`npm run build && npm run start:prod`) or equivalent.
- `ADMIN_TOKEN` is configured and known.
- `DATABASE_URL` points to a seeded Postgres database (at least ~20 `images` rows).
  - Include varied data: different `status`, `xRestrict`, `width/height`, `userId/userName`, and some tagged images.

## Access
1. Open `GET /admin` in a browser.
2. Authenticate using `Authorization: Bearer <ADMIN_TOKEN>` or `GET /admin?token=<ADMIN_TOKEN>`.
3. Navigate to the **Images** resource list.

Expected:
- Admin loads (no 5xx / “admin_not_ready”).
- Images list renders with rows.

## List columns (basic)
Verify the list contains the intended columns:
- `id`, `illustId`, `pageIndex`, `status`, `xRestrict`, `width`, `height`, `userId`

Expected:
- Values are present and correctly formatted.
- No broken UI elements (empty page, infinite loading, console errors).

## Filters (happy path)
For each filter below, apply it, confirm the list changes, then clear the filter:

1. `status`
   - Apply: `active`, `disabled`, `broken`
   - Expected: only rows with the selected status are shown.

2. `illustId`
   - Apply: a known existing `illustId` from the DB seed.
   - Expected: only rows with that `illustId` are shown (possibly multiple `pageIndex`).

3. `userId`
   - Apply: a known existing `userId`.
   - Expected: only rows for that user are shown.

4. `userName`
   - Apply: a known existing `userName` (exact/contains matching depends on AdminJS implementation).
   - Expected: rows returned match the UI’s matching semantics; note the semantics if surprising.

5. `xRestrict`
   - Apply: `0` (all-ages) and `1`/`2` (R18/R18G).
   - Expected: rows match the selected value.

6. `orientation`
   - Apply: a known orientation value.
   - Expected: rows match.

7. `minWidth` and `minHeight`
   - Apply: `minWidth=1000`, `minHeight=1000` (or other values that should narrow results).
   - Expected: only rows with `width >= minWidth` and/or `height >= minHeight`.

8. `tag`
   - Apply: a known tag name that exists in `tags` and is linked through `image_tags`.
   - Expected: only images with that tag appear.

## Filters (negative / edge cases)
1. Invalid numeric inputs
   - Apply non-numeric values to numeric filters (`illustId`, `userId`, `minWidth`, `minHeight`).
   - Expected: UI either blocks submission or backend responds with a clear error (no crash).

2. Unknown tag
   - Apply a tag that does not exist.
   - Expected: empty result set (no crash).

3. Combined filters
   - Apply multiple filters together (e.g., `status=active` + `xRestrict=0` + `minWidth=1000`).
   - Expected: intersection semantics (result set is narrowed accordingly).

## Notes to capture during execution
- AdminJS version and server version/commit.
- Any filter semantics that are “contains vs equals”.
- Performance observations (slow load, timeouts, heavy queries).

