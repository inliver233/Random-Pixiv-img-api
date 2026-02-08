# API 合约与参数矩阵审计（/random + 分类检索 + healthz/metrics + legacy）

- 审计时间：2026-02-09 05:56:38（本机时间；新的证据链时间戳）
- 目标站点：`https://i.mukyu.ru`
- 覆盖策略：按 README 与 `docs/api/*` 契约做参数矩阵与异常态验证，并对错误包结构、缓存头、重定向语义做一致性检查
- 本轮证据目录（时间戳：`2026-02-09_05-56-38`）：
  - Network：`docs/review/network/2026-02-09_05-56-38/`
  - Console：`docs/review/console/2026-02-09_05-56-38/`

> 安全硬规则：本文档与所有落盘证据均不得包含任何完整凭据（token/password/refresh_token/proxy 密码/cookie/Authorization）。如需引用，仅用掩码（如 `Px***` / `***`）。

---

## 0. 审计基线摘要（执行前必读 → 本轮已读）

基线来源：
- `E:/pixiv-download-修改版本/最初计划.txt`
- `pixiv-反代/pixivcat-backend/随机api开发规划.md`
- `pixiv-反代/pixivcat-backend/README.md`
- `pixiv-反代/pixivcat-backend/docs/api/random.md`
- `pixiv-反代/pixivcat-backend/docs/api/classification.md`
- `pixiv-反代/pixivcat-backend/docs/errors.md`
- `pixiv-反代/pixivcat-backend/docs/usage/handbook.md`
- 上一轮线上契约证据（主时间戳：`2026-02-08_04-48-29`）：
  - `pixiv-反代/pixivcat-backend/docs/review/2026-02-08_04-48-29-api-contract-audit.md`
  - `pixiv-反代/pixivcat-backend/docs/review/network/2026-02-08_04-48-29/`

本轮重点复核（必须先复现再改）：
- D) `min_width/min_height/min_pixels` 超过 Postgres int4 上限触发 500（应 400，且错误包结构化）
- /metrics 暴露面（是否启用 basic auth / 是否可控禁用）
- /random 强筛选的可解释性（NO_MATCH hints）与元信息覆盖率现状（tags/authors/尺寸/分级）

---

## 1. 复现与证据（待填充）

> 每次请求必须记录：URL、method、status、关键头（Cache-Control/Location/Content-Type/X-Request-Id 等）与 body 摘要（JSON 时）。

### 1.1 /random（三形态）
- [ ] `GET /random`（binary）
- [ ] `GET /random?format=json`（JSON）
- [ ] `GET /random?redirect=1`（302）
- [ ] `GET /random?redirect=1`（follow 302 → /i/* 长缓存）

### 1.2 /random 参数矩阵（异常态优先）
- [ ] `format` 非法 → 400
- [ ] `attempts` clamp/非法 → 200/400
- [ ] `seed` 空白 → 400；可复现 → 200
- [ ] `r18/orientation/included_tags/excluded_tags/user_id/illust_id` 合法/非法 → 200/400
- [ ] `min_width/min_height/min_pixels`：
  - [ ] 边界：`2147483647`（应允许）
  - [ ] 超界：`2147483648`（必须 400，不得 500）

---

## 2. 本轮复现：Top 高危（D）

### [D] `min_width` 超过 Postgres int4 上限触发 500（应 400）
- 请求：
  - `GET /random?format=json&min_width=2147483648` → `500`（body `code=P2020`）
  - `GET /images?limit=1&min_width=2147483648` → `500`（body `code=P2020`）
- 证据（落盘）：
  - `docs/review/network/2026-02-09_05-56-38/api-D1-random-min_width-int4over.headers.txt`
  - `docs/review/network/2026-02-09_05-56-38/api-D1-random-min_width-int4over.body.txt`
  - `docs/review/network/2026-02-09_05-56-38/api-D2-images-min_width-int4over.headers.txt`
  - `docs/review/network/2026-02-09_05-56-38/api-D2-images-min_width-int4over.body.txt`
- 对照边界值（应允许并走正常筛选/NO_MATCH）：
  - `GET /random?format=json&min_width=2147483647` → `404 NO_MATCH`
  - 证据：`docs/review/network/2026-02-09_05-56-38/api-D3-random-min_width-int4max.headers.txt`、`docs/review/network/2026-02-09_05-56-38/api-D3-random-min_width-int4max.body.txt`


### 1.3 分类/检索接口
- [ ] `GET /tags`
- [ ] `GET /authors`
- [ ] `GET /images`
- [ ] `GET /images/:id`

### 1.4 运行态与可观测
- [ ] `GET /healthz`
- [ ] `GET /metrics`（验证 enabled/disabled 与 basic auth）

### 1.5 legacy 兼容路由
- [ ] `GET /:illustId.:ext`
- [ ] `GET /:illustId-:page.:ext`
