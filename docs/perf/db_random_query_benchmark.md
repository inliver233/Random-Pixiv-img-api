# DB benchmark: pickRandom

This document records a repeatable benchmark for the `pickRandom` SQL paths and a place to paste `EXPLAIN (ANALYZE, BUFFERS)` output.

Related reference (strategy + rationale): `docs/perf.md`

## Prereqs
- Postgres running and seeded with `images` rows (`status=1`).
- Helpful indexes exist (see migrations), especially:
  - `images_uniq`
  - `images_filter_idx`

## Run
Use the provided SQL file:

```bash
psql "$DATABASE_URL" -f scripts/db_random_query_benchmark.sql
```

## Suggested baseline / thresholds (guide)
- `pickRandom (random_key)` should be index-driven and complete in low ms on a warmed cache.
- `TABLESAMPLE` should avoid full-table scans; adjust sample % if filters are strict.
- Track changes between releases; investigate regressions > 2x in total runtime or buffer reads.

## Benchmark record (paste output)
Paste `EXPLAIN (ANALYZE, BUFFERS)` output here for your environment:

### random_key phase 1

```text
(paste output)
```

### random_key wrap-around

```text
(paste output)
```

### TABLESAMPLE downgrade

```text
(paste output)
```

