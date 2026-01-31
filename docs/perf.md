# Performance Notes

This document focuses on DB-side performance for the random pick query.

## pickRandom (random_key)

The primary strategy uses a precomputed `random_key ∈ [0,1)` and a two-phase query:

1) `random_key >= r` ordered by `random_key`, `LIMIT 1`  
2) If empty, wrap-around: ordered by `random_key`, `LIMIT 1`

Expected: index-driven query (avoid `ORDER BY random()` full sort).

## Optional downgrade: TABLESAMPLE

When the `random_key` strategy degrades (e.g. certain filters lead to a large scan), a `TABLESAMPLE SYSTEM (p)` strategy can be used as a downgrade:

- Randomly samples table blocks, then applies the same basic filters.
- This is approximate randomness and may return no rows for strict filters depending on sample rate `p`.

## Manual verification (EXPLAIN ANALYZE)

Prereqs:
- Postgres running and seeded with some `images` rows (status=1).
- `images_filter_idx` exists (see migrations).

Example commands (psql):

```sql
-- random_key phase 1
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM images
WHERE status = 1
  AND random_key >= 0.5
ORDER BY random_key
LIMIT 1;

-- wrap-around
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM images
WHERE status = 1
ORDER BY random_key
LIMIT 1;

-- TABLESAMPLE downgrade (example 1%)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM images TABLESAMPLE SYSTEM (1)
WHERE status = 1
LIMIT 1;
```

What to look for:
- No `Sort Method: quicksort` over a large row count for random selection.
- Index usage for the random_key queries (`Index Scan` on filter idx when applicable).

