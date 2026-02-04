# PPOOL-0106: DB 索引与约束审计（user_id / created_at_pixiv / tag）

- Date: 2026-02-05
- Migration: `prisma/migrations/20260204185819_ppool_0106_indexes_audit`
- Dataset (local perf check):
  - PostgreSQL 14 (WSL2, localhost:5432)
  - `images`: 50,000 rows
  - `tags`: 20 rows
  - `image_tags`: 100,000 rows

> 目的：验证新增索引能避免明显的全表扫描退化，并对典型查询给出可追溯的 `EXPLAIN` 结果。

## 1) user_id + random_key（随机挑图按作者过滤）

Query:
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM images
WHERE status = 1
  AND user_id = 123
  AND random_key >= 0.5
ORDER BY random_key ASC
LIMIT 1;
```

Result:
```text
Limit  (cost=0.41..2.44 rows=1 width=12) (actual time=0.192..0.193 rows=1 loops=1)
  Buffers: shared hit=13
  ->  Index Scan using images_user_random_idx on images  (cost=0.41..50.98 rows=25 width=12) (actual time=0.190..0.191 rows=1 loops=1)
        Index Cond: ((status = 1) AND (user_id = 123) AND (random_key >= '0.5'::double precision))
        Buffers: shared hit=13
Planning:
  Buffers: shared hit=205
Planning Time: 1.722 ms
Execution Time: 0.317 ms
```

## 2) created_at_pixiv（按年份/时间范围筛选）

Query:
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM images
WHERE created_at_pixiv >= (now() - interval '30 days')
ORDER BY created_at_pixiv DESC
LIMIT 50;
```

Result:
```text
Limit  (cost=0.29..42.16 rows=50 width=16) (actual time=0.147..0.820 rows=50 loops=1)
  Buffers: shared hit=52
  ->  Index Scan Backward using images_created_at_pixiv_idx on images  (cost=0.29..3738.34 rows=4464 width=16) (actual time=0.145..0.810 rows=50 loops=1)
        Index Cond: (created_at_pixiv >= (now() - '30 days'::interval))
        Buffers: shared hit=52
Planning:
  Buffers: shared hit=180
Planning Time: 0.972 ms
Execution Time: 0.851 ms
```

## 3) tag 维度（included_tags 子查询）

Query:
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT it.image_id
FROM image_tags it
JOIN tags t ON t.id = it.tag_id
WHERE t.name IN ('tag_1','tag_2')
GROUP BY it.image_id
HAVING COUNT(DISTINCT t.name) = 2;
```

Result:
```text
GroupAggregate  (cost=1173.47..1373.47 rows=500 width=8) (actual time=5.453..12.611 rows=2500 loops=1)
  Group Key: it.image_id
  Filter: (count(DISTINCT t.name) = 2)
  Rows Removed by Filter: 5000
  Buffers: shared hit=75
  ->  Sort  (cost=1173.47..1198.47 rows=10000 width=14) (actual time=5.344..5.896 rows=10000 loops=1)
        Sort Key: it.image_id
        Sort Method: quicksort  Memory: 853kB
        Buffers: shared hit=67
        ->  Nested Loop  (cost=0.42..509.09 rows=10000 width=14) (actual time=0.073..2.790 rows=10000 loops=1)
              Buffers: shared hit=64
              ->  Seq Scan on tags t  (cost=0.00..1.25 rows=2 width=14) (actual time=0.012..0.024 rows=2 loops=1)
                    Filter: (name = ANY ('{tag_1,tag_2}'::text[]))
                    Rows Removed by Filter: 18
                    Buffers: shared hit=1
              ->  Index Only Scan using image_tags_tag on image_tags it  (cost=0.42..203.92 rows=5000 width=16) (actual time=0.044..0.915 rows=5000 loops=2)
                    Index Cond: (tag_id = t.id)
                    Heap Fetches: 0
                    Buffers: shared hit=63
Planning:
  Buffers: shared hit=177
Planning Time: 0.748 ms
Execution Time: 12.838 ms
```
