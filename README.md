# pixivcat-backend → Random Anime Image API

在 **不破坏现有 Pixivcat 兼容路由**（legacy）的前提下，将本项目逐步升级为「随机二次元图片 API」：
- `/random`：随机返回图片流（默认） / JSON（`format=json`） / 302 跳转（`redirect=1`）
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

## 可观测与健康检查

- `GET /healthz`：健康检查（实现后生效）
- `GET /metrics`：Prometheus 指标（实现后生效）

## 开发

要求：
- Node.js `>=24`

启动（当前仓库会在后续 Issues 中补齐完整脚本与 TS build）：

```bash
npm ci
npm run dev
```

## 环境变量（后续按 Issues 增量补齐）

最小（legacy 路由仍依赖 Pixiv token 轮换 + memcached）：
- `REFRESH_TOKENS`：JSON 数组字符串（严禁写入日志）
- `MEMCACHED_HOST` / `MEMCACHED_PORT` / `MEMCACHED_NAMESPACE`

升级后（随机 API / 后台 / 队列）将引入：
- `DATABASE_URL`（PostgreSQL）
- `ADMIN_TOKEN`（后台鉴权）

