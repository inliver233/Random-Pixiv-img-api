-- pickRandom benchmark (manual)
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/db_random_query_benchmark.sql
--
-- Notes:
-- - Replace the sample constants (random_key threshold, tags) as needed.
-- - This file is intentionally minimal and repeatable for manual perf baselining.

\\echo '== random_key phase 1 =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM images
WHERE status = 1
  AND random_key >= 0.5
ORDER BY random_key
LIMIT 1;

\\echo '== random_key wrap-around =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM images
WHERE status = 1
ORDER BY random_key
LIMIT 1;

\\echo '== TABLESAMPLE downgrade (1%) =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM images TABLESAMPLE SYSTEM (1)
WHERE status = 1
LIMIT 1;

\\echo '== tags filter (included_tags AND semantics example) =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM images
WHERE status = 1
  AND id IN (
    SELECT it.image_id
    FROM image_tags it
    JOIN tags t ON t.id = it.tag_id
    WHERE t.name IN ('cat', 'dog')
    GROUP BY it.image_id
    HAVING COUNT(DISTINCT t.name) = 2
  )
  AND random_key >= 0.5
ORDER BY random_key
LIMIT 1;

