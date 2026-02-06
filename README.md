# pixivcat-backend → Random Anime Image API

在 **不破坏现有 Pixivcat 兼容路由**（legacy）的前提下，将本项目逐步升级为「随机二次元图片 API」：
- `/random`：随机返回图片流（默认） / JSON（`format=json`） / 302 跳转（`redirect=1`）
- `/tags`、`/authors`、`/images`：分类检索接口（标签/作者/图片列表，JSON + 游标分页）
- 强筛选：`r18`、`orientation`、`min_width/min_height/min_pixels`、`included_tags/excluded_tags`、`user_id`、`illust_id`、`seed`、`attempts`
- 管理后台：`/admin`（导入/启用/禁用/软删/统计）
- 可观测：结构化日志 + `request_id`、Prometheus `/metrics`

> 合规默认值：`r18=0`（全年龄）。只有显式传入 `r18=1/2` 才会返回 R18/R18G 内容（实现后生效）。

## 兼容路由（必须保持可用）

这些路由用于 Pixivcat 兼容访问，保持 **流式代理**（不会把图片读入内存再返回）：

- 单图：`GET /:illustId.:ext`
- 多图：`GET /:illustId-:pageNumber.:ext`

示例：

```bash
# 单图（illustId=12345678）
curl -I "http://127.0.0.1:3000/12345678.jpg"

# 多图第 1 张（pageNumber 从 1 开始）
curl -I "http://127.0.0.1:3000/12345678-1.jpg"
```

缓存策略（legacy）：
- 成功响应：`Cache-Control: max-age=31536000, public`（长缓存，适合稳定 URL）

## 随机图片 API

### GET /random

默认：返回图片二进制（流式），并强制 `Cache-Control: no-store`（随机结果不可缓存）。

参数（实现后生效）：
- `format`: `image`（默认）| `json`
- `redirect`: `0`（默认）| `1`（返回 302，`Location` 指向稳定图片 URL，例如 `/i/:id.:ext`）
- `attempts`: `1..10`（默认实现会 clamp；用于内部失败换图次数）
- `seed`: string（同一 seed 下结果可复现，用于调试/回归）

强筛选（实现后生效）：
- `r18`: `0|1|2`（默认 `0`）
- `orientation`: `portrait|landscape|square|any`
- `min_width`, `min_height`, `min_pixels`: number
- `included_tags`, `excluded_tags`: string（支持多值；具体语义以 OpenAPI/实现为准）
- `user_id`, `illust_id`: number（用于作者/作品筛选）

示例（≥5 条）：

```bash
# 1) JSON 模式：返回结构化信息（包含稳定代理 URL 等）
curl "http://127.0.0.1:3000/random?format=json"

# 2) 推荐生产路径：redirect=1（更易被 CDN 缓存稳定 URL）
curl -I "http://127.0.0.1:3000/random?redirect=1"

# 3) 强筛选：竖图 + 最小宽高 + 限制重试次数
curl -I "http://127.0.0.1:3000/random?orientation=portrait&min_width=1080&min_height=1920&attempts=5"

# 4) 强筛选：全年龄（默认）+ 可复现 seed（用于调试）
curl -I "http://127.0.0.1:3000/random?seed=demo-seed-001"

# 5) JSON + 筛选（示例：排除某些标签）
curl "http://127.0.0.1:3000/random?format=json&excluded_tags=ai_generated|gore"
```

错误返回（JSON API）：
- JSON 模式失败时返回：`{ code, message, request_id }`

### GET /i/:id.:ext（稳定图片 URL）

`/random?redirect=1` 推荐跳转到此稳定 URL（实现后生效）：
- 从 DB 读取 `original_url/ext`，再进行流式代理
- 成功响应使用长缓存（适合 CDN）

## 分类检索 API

- `GET /tags`：标签检索，参数：`q`、`limit(1..100)`、`cursor`
- `GET /authors`：作者检索，参数：`q`、`limit(1..100)`、`cursor`
- `GET /images`：图片列表检索，参数：`limit(1..200)`、`cursor` + `/random` 同款筛选参数
- 所有分类检索接口返回 JSON，并强制 `Cache-Control: no-store`

## 快速 curl 示例（10 条）

```bash
# 1) /random JSON
curl "http://127.0.0.1:3000/random?format=json"

# 2) /random 302 redirect（推荐生产）
curl -I "http://127.0.0.1:3000/random?redirect=1"

# 3) /random 高分辨率竖图筛选
curl -I "http://127.0.0.1:3000/random?orientation=portrait&min_width=1080&min_height=1920&attempts=5"

# 4) /random 指定作者 + 排除标签
curl "http://127.0.0.1:3000/random?format=json&user_id=12345678&excluded_tags=ai_generated|gore"

# 5) /random 固定 seed（可复现）
curl "http://127.0.0.1:3000/random?format=json&seed=demo-seed-001"

# 6) /tags 模糊搜索 + limit
curl "http://127.0.0.1:3000/tags?q=猫&limit=20"

# 7) /authors 搜索
curl "http://127.0.0.1:3000/authors?q=alice&limit=20"

# 8) /images 列表筛选（含分页游标）
curl "http://127.0.0.1:3000/images?limit=50&cursor=0&r18=0&included_tags=cat|blue"

# 9) /images/:id 单图元信息
curl "http://127.0.0.1:3000/images/1"

# 10) legacy 兼容路由单图
curl -I "http://127.0.0.1:3000/12345678.jpg"
```

## 可观测与健康检查

- `GET /healthz`：健康检查（实现后生效）
- `GET /metrics`：Prometheus 指标（实现后生效）

## 开发

要求：
- Node.js `>=24`

启动（完整功能）：

```bash
npm ci
npm run build
npm run dev
```

说明：
- `npm run dev` 使用 `app.js`（CJS 入口）；当存在 `dist/` 时会优先委托到 `dist` 下的 TS 路由实现。
- 生产启动推荐：`npm run start:prod`（运行 `dist/app.js`）。

## 部署（Ubuntu 22 / 云服务器）

- Ubuntu 22.04 生产部署与使用教程：`docs/deployment/ubuntu22.md`
- 超详细使用手册（部署→使用→后台全流程）：`docs/usage/handbook.md`
- Docker Compose 单文件生产部署：`docs/deployment/docker-compose-prod.md`
- 部署安全清单：`docs/deployment/security-checklist.md`
- easy_proxies 对接（含一行 URI 导入）：`docs/usage/easy-proxies-integration.md`
- DB 迁移与回滚 Runbook：`docs/deployment/db-migrations.md`

## easy_proxies 极简对接（推荐）

后台路径：`/admin/pages/easyProxiesImport`

你可以直接在页面里粘贴一行或多行 URI，保存后立即生效（无需重启）：

```text
http://user:pass@127.0.0.1:18080
socks5://127.0.0.1:19090
http://user:pa@ss@127.0.0.1:18081
```

说明：
- 密码包含 `@` 时，可直接写（最后一个 `@` 作为 host 分隔）或使用 `%40` 编码。
- 导入策略建议使用 `skip_non_source`，避免覆盖已有手工维护节点。
- 导入完成后代理池会自动刷新运行时缓存，不需要重启服务。
- 导入反馈会给出 `imported / invalid / conflicts` 计数与逐行错误定位（`line` + 原始 URI）。

运行态证据（本轮）：
- 导入反馈截图：`docs/review/screenshots/2026-02-06_19-14-04/arux-0004-easy-import-summary.png`
- Admin 全站统一截图：`docs/review/screenshots/2026-02-06_19-14-04/arux-0005-dashboard-unified.png`
- 全量巡检结论：`docs/review/2026-02-06_18-44-05-admin-ui-runtime-findings.md`

## 回归与部署验证快捷命令

```bash
# 全量测试（lint + 全量 vitest + smoke）
npm run test:all

# 本轮修复重点回归（防止“未指定组件”与 URI 导入回归）
npm run test:admin-runtime
npm run test:runtime-regression

# Admin UI smoke（可附加 BaseUrl/AdminToken）
npm run smoke:admin-ui -- -BaseUrl http://127.0.0.1:3015 -AdminToken <ADMIN_TOKEN>

# Compose 结构校验（无需 Docker daemon）
docker compose -f docker-compose.yml config --services
```

`docker compose ... config --services` 预期输出：
- `memcached`
- `postgres`
- `migrate`
- `backend`

如运行环境缺少可用 Docker daemon，请将结果记录为 `validation_limited`，并在可用 daemon 环境复验 `docker compose up -d`。

## 环境变量（后续按 Issues 增量补齐）

最小（legacy 路由仍依赖 Pixiv token 轮换 + memcached）：
- `REFRESH_TOKENS`：JSON 数组字符串（严禁写入日志）
- `MEMCACHED_HOST` / `MEMCACHED_PORT` / `MEMCACHED_NAMESPACE`

升级后（随机 API / 后台 / 队列）将引入：
- `DATABASE_URL`（PostgreSQL）
- `ADMIN_TOKEN`（后台鉴权）
