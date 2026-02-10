# 线上 API 契约审计（Hydration 缺失导致的筛选退化）

- 目标站点：`https://i.mukyu.ru`
- 时间戳：`2026-02-10_23-45-39`
- 工具：pwsh `Invoke-WebRequest`（仅调用公开 API；不含任何凭据）

## 1) /version 与 /healthz（追溯性门槛）

### 1.1 `/version`

- 请求：`GET https://i.mukyu.ru/version`
- 结果：200，但 `commit=null`（不可追溯部署）
- 证据：
  - `docs/review/network/2026-02-10_23-45-39/version.head.txt`
  - `docs/review/network/2026-02-10_23-45-39/version.body.txt`

### 1.2 `/healthz`

- 请求：`GET https://i.mukyu.ru/healthz`
- 结果：200，依赖项 `ok=true`；但 `build.commit=null`
- 证据：
  - `docs/review/network/2026-02-10_23-45-39/healthz.head.txt`
  - `docs/review/network/2026-02-10_23-45-39/healthz.body.txt`

## 2) /random（可用但元数据退化）

### 2.1 默认随机（format=json）

- 请求：`GET https://i.mukyu.ru/random?format=json`
- 结果：200，能返回图片，但元数据大量为空：
  - `width/height=null`
  - `orientation=unknown`
  - `tags=[]`
  - `author.user_id/name=null`
- 证据：
  - `docs/review/network/2026-02-10_23-45-39/random_format-json.head.txt`
  - `docs/review/network/2026-02-10_23-45-39/random_format-json.body.txt`

### 2.2 强筛选：`r18=1`（NO_MATCH）

- 请求：`GET https://i.mukyu.ru/random?format=json&r18=1`
- 结果：非 2xx（`NO_MATCH`），hints 显示应用了 `xRestrict=1`，建议 fallback
- 证据：
  - `docs/review/network/2026-02-10_23-45-39/random_format-json_r18-1.error.txt`

### 2.3 强筛选：`orientation + min_width`（NO_MATCH）

- 请求：`GET https://i.mukyu.ru/random?format=json&orientation=landscape&min_width=1000`
- 结果：非 2xx（`NO_MATCH`），hints 明确提示需 backfill：
  - `run hydration backfill to improve metadata coverage`
- 证据：
  - `docs/review/network/2026-02-10_23-45-39/random_format-json_orientation-landscape_min_width-1000.error.txt`

## 3) /tags 与 /authors（空数据）

### 3.1 `/tags`

- 请求：`GET https://i.mukyu.ru/tags`
- 结果：200，`items=[]`
- 证据：
  - `docs/review/network/2026-02-10_23-45-39/tags.head.txt`
  - `docs/review/network/2026-02-10_23-45-39/tags.body.txt`

### 3.2 `/authors`

- 请求：`GET https://i.mukyu.ru/authors`
- 结果：200，`items=[]`
- 证据：
  - `docs/review/network/2026-02-10_23-45-39/authors.head.txt`
  - `docs/review/network/2026-02-10_23-45-39/authors.body.txt`

## 4) 结论与下一步

当前随机 API 在“仅返回图片 URL”的退化层面可用，但你要求的“高度可自定义筛选”依赖 `Image.tags/author/xRestrict/geometry` 等字段：
- 从 Hydration Ops 可见这些字段覆盖率为 0（详见同时间戳 Admin 审计文档：`docs/review/2026-02-10_23-45-39-admin-deep-audit.md`）
- 因此本轮优先级必须是：**修复 hydrate_metadata/hydration_backfill 的 illust_id 解析阻断 → 重跑/重试 DLQ → 回填元数据覆盖率 → 回归 /tags /authors /random 参数矩阵**

