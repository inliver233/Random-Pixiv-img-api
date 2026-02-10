# API 契约审计（线上抽样 + 证据落盘）— 2026-02-10_18-39-57

目标站点：`https://i.mukyu.ru`

> 说明：本文件记录公开 API 的“可重复请求证据”（head/body），并对照预期契约给出差异。所有证据文件均不包含任何完整凭据。

## 0. 版本追溯

- `GET /version`：`commit=null`（追溯缺失）
  - head：`docs/review/network/2026-02-10_18-39-57/api-version.head.txt`
  - body：`docs/review/network/2026-02-10_18-39-57/api-version.body.json`
- `GET /healthz`：`build.commit=null`（同上）
  - head：`docs/review/network/2026-02-10_18-39-57/api-healthz.head.txt`
  - body：`docs/review/network/2026-02-10_18-39-57/api-healthz.body.json`

## 1. /random

### 1.1 `GET /random`（默认 image）

- 线上返回：`404` + HTML（`No matching image.`）
- 结论：并非路由缺失，而是数据为空（Image=0），导致 `NO_MATCH`。
- 证据：
  - head：`docs/review/network/2026-02-10_18-39-57/api-random.head.txt`
  - body：`docs/review/network/2026-02-10_18-39-57/api-random.body.html`

### 1.2 `GET /random?format=json`

- 线上返回：`404` + JSON（`code=NO_MATCH`）
- 证据：
  - head：`docs/review/network/2026-02-10_18-39-57/api-random-json.head.txt`
  - body：`docs/review/network/2026-02-10_18-39-57/api-random-json.body.json`

## 2. 分类检索（classification）

### 2.1 `GET /images?limit=1`

- 线上返回：`items=[]`
- 证据：
  - head：`docs/review/network/2026-02-10_18-39-57/api-images.head.txt`
  - body：`docs/review/network/2026-02-10_18-39-57/api-images.body.json`

### 2.2 `GET /tags`

- 线上返回：`items=[]`
- 证据：
  - head：`docs/review/network/2026-02-10_18-39-57/api-tags.head.txt`
  - body：`docs/review/network/2026-02-10_18-39-57/api-tags.body.json`

### 2.3 `GET /authors`

- 线上返回：`items=[]`
- 证据：
  - head：`docs/review/network/2026-02-10_18-39-57/api-authors.head.txt`
  - body：`docs/review/network/2026-02-10_18-39-57/api-authors.body.json`

结论：分类检索契约存在，但当前数据为空（与 Admin 侧 Image=0 一致）。

## 3. 运行态与指标

- `GET /metrics`：`404`
  - 证据：`docs/review/network/2026-02-10_18-39-57/api-metrics.head.txt`
  - 备注：预期行为取决于 `METRICS_ENABLED` 与鉴权策略；当前表现为未暴露指标端点。

## 4. 关键差异与修复优先级

1) **数据闭环阻断（最高优先级）**：导入 jobs 未成功落 images → `/random` 永远 `NO_MATCH` → `/images|/tags|/authors` 永远空。
   - 证据与根因见：`docs/review/2026-02-10_18-39-57-admin-deep-audit.md`
2) **部署追溯缺失（高优先级）**：`/version.commit=null` 导致无法确认线上运行 commit；需要在部署时注入 `APP_COMMIT`（或平台变量）并把 smoke 作为门禁。

