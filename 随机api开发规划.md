# Pixivcat-Backend →「随机二次元图片 API」迭代升级：全面调研 & 完整规划（仅文档，不改代码）

> 本文件为 **Windows / PowerShell 7 友好**的 UTF-8 文档（建议以 **UTF-8 with BOM** 保存，避免中文乱码；本仓库后续落地实现也建议统一 UTF-8 编码）。

- 时间：2026-01-31
- 工作区：`E:\pixiv-download-修改版本\pixiv-反代\pixivcat-backend`
- 当前代码版本：`git rev-parse HEAD` = `96fa296aaf807b193fb254a20b0aaf4bb188098f`
- 现状说明：`git log -1` 显示 tag 为 `v1.1.2`，但 `package.json` 仍是 `1.1.1`（后续迭代应统一版本源）

---

## 0. 你的需求（逐条工程化拆解）

你现在有一个“Pixiv 图片反向代理”项目（pixivcat-backend），它已经可以把 Pixiv 图片以代理方式对外输出。你希望基于此项目，升级为一个**强大的「随机二次元图片 API」项目**，核心需求包括：

1. **随机图片**
   - 最基础：随机返回一张图片（默认直接返回图片二进制）
   - 高级：可返回 JSON（类似图床返回：包含图片 URL、元信息、可选变换 URL 等）
2. **强筛选**
   - URL 参数指定：横向/竖向/方图、尺寸（宽高、像素阈值、分辨率大于某值）
   - 基于 Pixiv 元信息的筛选：R18、作者、标签等
3. **管理后台（不停机热更新）**
   - 不关闭项目的情况下：可以新增/删除 Pixiv 原生图片 URL
   - 变更实时生效（图片库“热更新”）
4. **稳健性 / 质量**
   - 如果某张图在代理时出现 404 等错误，**不能直接把错误返回给用户**
   - 需要在后端内部做重试 / 换图 / 降级，尽量给用户返回成功结果
5. **统计与运维**
   - 后台看到常用统计：请求数、总图片数、请求成功率、资源占用等
6. **工程目标**
   - 代码精良、可维护、可拓展
   - 高性能，能够在低配云服务器上承载巨大请求量，尽量不出错
   - 数据库需要全面设计/重构（为筛选、统计、热更新打基础）

本规划的目标是：在“不修改现有代码”的前提下，输出一份**可以直接按图施工**的总体方案，包括：现状审计、差距分析、接口契约、数据库设计、架构、伪代码、风险与路线图。

---

## 1. 现有项目全面审计（当前情况 / 功能 / 结构 / 质量）

### 1.1 技术栈与运行形态（现状）

- Node.js + Express（`express` 5.2.1）
- HTTP 客户端：`axios`
- 缓存：`memcached`（用于缓存 Pixiv API 的 JSON 响应）
- 模板：`ejs`（仅用于错误页）
- Docker 部署：`Dockerfile` + `docker-compose.yml`（包含 memcached）

入口与路由：

- 入口：`app.js`
- 路由：`src/routes/pixivRoutes.js`

### 1.2 目录结构（当前非常清晰，规模小，利于迭代）

- `app.js`：Express 启动、挂载路由、全局错误处理中间件
- `src/routes/pixivRoutes.js`：Pixiv.cat 风格的两条图片路由
- `src/controllers/imageProxyController.js`：图片代理核心（Pixiv API → 解析原图 URL → axios stream pipe）
- `src/services/pixivService.js`：调用 Pixiv App API（`/v1/illust/detail`）
- `src/services/pixivAuthService.js`：refresh token 刷 access token（支持多 token 轮换）
- `src/services/memcachedService.js`：memcached get/set 封装
- `src/middlewares/validationMiddleware.js`：illustId/page/ext 参数校验
- `views/error.ejs`：错误页

### 1.3 当前已实现的核心功能（必须保留/复用）

#### 1) 图片代理路由

- 单图：`GET /:illustId.:fileExtension`
  - 例：`/12345678.jpg`
- 多图：`GET /:illustId-:pageNumber.:fileExtension`
  - 例：`/12345678-2.jpg`

#### 2) 流式转发（性能关键点：正确）

`imageProxyController` 使用 `axios.get(..., responseType: 'stream')` 并 `pipe(res)`：

- 不把整张图片读入内存（对大图至关重要）
- 处理 client disconnect 时 destroy 上游流，避免资源泄漏
- 返回头包含：
  - `Cache-Control: max-age=31536000, public`（非常适合上 CDN）
  - `Access-Control-Allow-Origin: *`
  - `X-Origin-URL`（真实来源 URL，利于排障/追溯）
  - `X-Crawl-Date`

#### 3) Pixiv API 缓存 + 多 token 轮换（适合高并发）

- Pixiv App API：`https://app-api.pixiv.net/v1/illust/detail?illust_id=...`
- memcached 按 illustId 缓存 detail JSON（默认 3600 秒）
- `REFRESH_TOKENS` 支持多个 refresh token，轮换获取 access token（分摊限流压力）

#### 4) 错误识别（当前已有基础，但需要体系化）

已有：

- Pixiv API 返回 `error` 或返回 `limit_unknown_360.png` 的场景识别并输出友好 404 页面
- Pixiv API rate limit 触发时返回 503 并带 `Retry-After`

### 1.4 现有实现的瓶颈（升级随机 API 前必须正视）

> 最关键结论：**当前热路径依赖 Pixiv API**。如果把它直接扩展为“随机 API”，高 QPS 时会被 Pixiv API 限流/延迟拖垮。

1) **每次图片请求都要调用 Pixiv API 才知道原图 URL**
   - 现状路由的参数是 illustId/page/ext，并不直接包含完整原图 URL，所以必须先调 Pixiv API。
   - 在“随机图片 API”场景，这会成为最大瓶颈（上游限流/网络抖动都会放大）。
2) **错误处理存在潜在二次异常**
   - `pixivService` catch 分支直接访问 `error.response.status`，遇到网络错误 `error.response` 为空时可能二次抛错（后续重构要修）。
3) **数据模型缺失**
   - 随机/筛选/统计/热更新都需要数据库；当前项目没有图片库 DB。
4) **无管理后台**
   - 热更新、统计、图片状态管理都需要后台入口。

---

## 2. 升级方向总纲（核心思想：把 Pixiv API 从热路径移走）

### 2.1 为什么必须这么做

你要达到的目标是“低配机器扛巨大请求量”，那么必须让热路径尽可能只做：

- **一次 DB 快速随机挑选（索引命中）**
- **一次 HTTP 流式代理（或更好：302 重定向）**

Pixiv App API 调用应尽量变成“冷路径/后台任务”，只在以下场景使用：

- 新 URL 入库时：拉取作者/标签/R18/宽高等元信息
- 图片代理失败（404/403）时：尝试通过 Pixiv API 自愈刷新最新 original_url

### 2.2 两种“随机图片返回模式”（都要支持，但建议默认用更抗压的）

1) **直接返回图片（你的“默认返回图片”需求）**
   - `GET /random` → 直接代理图片流
   - 优点：使用者最简单
   - 缺点：后端需要承担大流量图片带宽与并发，成本更高
2) **302 重定向（强烈建议作为“高并发生产模式”）**
   - `GET /random?redirect=1` → 302 到稳定图片 URL（例如 `/:illustId-:page.:ext` 或新的 `/i/:id`）
   - 图片 URL 可长缓存（CDN/浏览器命中），后端主要承受“挑图 + 重定向”的轻负载

> 关键缓存策略：  
> - `/random` 端点必须 `Cache-Control: no-store`（否则 CDN 缓存会导致“不随机”）  
> - 图片静态 URL 继续用 `Cache-Control: max-age=31536000, public`

---

## 3. 对标调研：成熟随机图片 API 的设计可借鉴点（联网调研结果）

> 本节给出“可直接抄作业”的参数语义与工程实践来源（后续实现不必再大海捞针）。

### 3.1 waifu.im（强烈建议作为接口设计蓝本）

waifu.im 的 `/search` 接口提供：

- `included_tags` / `excluded_tags`
- `is_nsfw`
- `orientation`
- `width` / `height` 且支持比较操作符（`>=2000` / `<=` / `!=` 等）
- `limit`（批量返回）

参考：

- `https://docs.waifu.im/reference/api-reference/search`
- `https://docs.waifu.im/tags`

### 3.2 图像变换：imgproxy（必须签名，防止被滥用）

如果你要“像图床一样通过 URL 参数裁剪/缩放/格式转换”，建议引入 imgproxy（或同类服务），并开启签名：

- `https://docs.imgproxy.net/usage/signing_url`
- `https://docs.imgproxy.net/3.25.x/configuration/options`（`IMGPROXY_KEY` / `IMGPROXY_SALT`）

理由：开放的图片变换 URL 极易被当作免费图片处理机，导致 CPU 被打爆，**必须签名**。

### 3.3 稳健性组件（重试/退避/熔断/限流）

- axios 层重试：`axios-retry`  
  `https://github.com/softonic/axios-retry`
- 业务层重试（“失败就换图再试”）：`p-retry`  
  `https://github.com/sindresorhus/p-retry`
- 熔断器：`opossum`  
  `https://github.com/nodeshift/opossum` / `https://nodeshift.dev/opossum/`
- Express 限流：`express-rate-limit`  
  `https://github.com/express-rate-limit/express-rate-limit`

### 3.4 随机选取的数据库性能问题（别用 ORDER BY random()）

大表中 `ORDER BY random()` 会导致全表随机排序，性能灾难。PostgreSQL 有 `TABLESAMPLE` 机制可以用于快速抽样，或使用“随机键列 random_key + 索引”做近似均匀随机。

参考：

- PostgreSQL `TABLESAMPLE`（概念与语法）  
  `https://www.postgresql.org/docs/current/sql-select.html`（SELECT 章节包含 TABLESAMPLE）
- 实测文章：  
  `https://www.redpill-linpro.com/techblog/2021/05/07/getting-random-rows-faster.html`

### 3.5 Pixiv token 获取与登录流程（当前项目已依赖）

ZipFile 的 Pixiv OAuth Flow（获取 refresh_token 常用指南）：

- `https://gist.github.com/ZipFile/c9ebedb224406f4f11845ab700124362`

> 注意：refresh token 属于敏感信息，必须只在服务端保存，且应提供轮换机制。

---

## 4. 完整架构设计（完全体：高性能、可维护、可扩展）

### 4.1 推荐整体形态：单体优先、模块化拆分

第一阶段建议做成单体（部署简单），但代码按模块拆分，便于未来拆服务：

- `api-server`（Node/Express）
  - `/random`、`/images/*`：对外 API
  - `/admin/*`：管理后台
  - `/metrics`：指标
- `db`：PostgreSQL（强推荐）  
  - 备选：SQLite（只适合小规模+单机，且随机/并发能力有限）
- `cache`（可选但推荐）：Redis
  - 计数器/限流 store/短 TTL 缓存/队列
  - 现有 memcached 可继续用于“Pixiv API detail 缓存”，但统计/限流更适合 Redis
- `image-transform`（可选）：imgproxy

### 4.2 数据流（核心链路）

1. 用户请求 `GET /random?...`
2. 服务器从 DB 根据筛选条件挑一条“候选图片记录”
3. 尝试返回：
   - `redirect=1`：302 到稳定图片 URL
   - 否则：流式代理该图片（对 pximg 发送带 Referer 的请求）
4. 若代理失败：
   - 标记失败计数
   - 换图重试（最多 N 次）
   - 必要时触发“自愈任务”（通过 Pixiv API 刷新 URL 或标记 broken）
5. 更新统计

---

## 5. 数据库设计（热更新 + 强筛选 + 随机性能的根基）

### 5.1 为什么必须 DB 化（而不是文本列表）

你要实现：标签/作者/R18/尺寸筛选、失败重试、成功率统计、热更新管理后台、未来扩展（多来源、多策略）。这些都需要：

- 结构化存储（字段、索引）
- 状态机（active/disabled/broken）
- 统计与审计
- 并发安全写入与查询

### 5.2 建议主模型：以“单张图片资源(illustId + page)”为粒度

原因：多页作品（manga）本质上是多张图片，随机 API 也应该以单张为单位随机挑选。

#### 表结构（PostgreSQL 建议版）

```sql
-- images：一条记录代表一张图片（illustId + page_index）
CREATE TABLE images (
  id               BIGSERIAL PRIMARY KEY,

  illust_id        BIGINT NOT NULL,
  page_index       INT NOT NULL,              -- 0-based 对应 _p0/_p1...
  ext              TEXT NOT NULL,             -- jpg/png/gif/webp（按策略）

  original_url     TEXT NOT NULL,             -- i.pximg.net 原图 URL（热路径直接用）
  proxy_path       TEXT NOT NULL,             -- 对外稳定 URL（可保持现有风格或新增 /i/:id）

  width            INT,
  height           INT,
  aspect_ratio     REAL,
  orientation      SMALLINT,                  -- 1 portrait / 2 landscape / 3 square / 0 any

  x_restrict       SMALLINT,                  -- 0/1/2...（R18/R18G 等）
  ai_type          SMALLINT,                  -- 可选：AI 标记（如你要“排除AI”）

  user_id          BIGINT,
  user_name        TEXT,
  title            TEXT,
  created_at_pixiv TIMESTAMP,

  status           SMALLINT NOT NULL DEFAULT 1, -- 1 active / 2 disabled / 3 broken
  fail_count       INT NOT NULL DEFAULT 0,
  last_fail_at     TIMESTAMP,
  last_ok_at       TIMESTAMP,
  last_error_code  TEXT,
  last_error_msg   TEXT,

  random_key       REAL NOT NULL,             -- 0..1，写入时生成；用于高性能随机

  added_at         TIMESTAMP NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX images_uniq ON images(illust_id, page_index);
CREATE INDEX images_filter_idx
  ON images(status, x_restrict, orientation, width, height, random_key);

-- tags：规范化标签（便于索引与扩展多语言）
CREATE TABLE tags (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  translated_name TEXT
);

CREATE TABLE image_tags (
  image_id BIGINT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  tag_id   BIGINT NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY(image_id, tag_id)
);

CREATE INDEX image_tags_tag ON image_tags(tag_id, image_id);

-- imports：记录后台批量导入任务（便于追溯与审计）
CREATE TABLE imports (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  created_by TEXT,
  source TEXT,
  total INT NOT NULL,
  success INT NOT NULL,
  failed INT NOT NULL,
  detail JSONB
);
```

### 5.3 高性能随机算法（推荐：random_key + 两段查询）

> 目标：避免 `ORDER BY random()` 对全表随机排序。

思路：

1. 每条记录写入时生成 `random_key ∈ [0,1)`
2. 查询时生成 `r=random()`：
   - 先找 `random_key >= r` 的第一条
   - 若无结果，回环取 `random_key` 最小的第一条

伪 SQL：

```sql
-- 第一次：random_key >= r
SELECT *
FROM images
WHERE status = 1
  AND (:x_restrict_is_any OR x_restrict = :x_restrict)
  AND (:orientation_is_any OR orientation = :orientation)
  AND (:min_width  IS NULL OR width  >= :min_width)
  AND (:min_height IS NULL OR height >= :min_height)
  AND random_key >= :r
ORDER BY random_key
LIMIT 1;

-- 回环
SELECT *
FROM images
WHERE status = 1
  AND ...
ORDER BY random_key
LIMIT 1;
```

标签筛选加入后：

- 先通过 `image_tags` / `tags` 过滤得到候选集合（索引命中）
- 再在候选集合上套 random_key 策略

### 5.4 “失败图片冷却”机制（显著提高成功率）

为了避免某些 broken 图片被频繁抽到，建议引入：

- `last_fail_at`：最近失败时间
- `fail_count`：失败次数

并在随机挑选 SQL 中排除“刚失败过的记录”，例如：

- `WHERE last_fail_at IS NULL OR last_fail_at < now() - interval '10 minutes'`

这样能够显著提高用户请求的成功率与体验。

---

## 6. API 设计（对外随机图片 API：默认图片 / 可 JSON / 强过滤）

### 6.1 保留现有兼容路由（必须）

继续保留现有 pixivcat 风格路由：

- `GET /:illustId.:ext`
- `GET /:illustId-:pageNumber.:ext`

随机 API 应当在其基础上新增，并尽量复用现有代理逻辑与头部策略。

### 6.2 新增端点（推荐最小集合）

对外：

- `GET /random`
  - 默认：图片二进制（`Content-Type: image/*`）
  - `?format=json`：返回 JSON
  - `?redirect=1`：302 到稳定图片 URL（推荐生产高并发使用）
- `GET /images/:id`：返回单条记录 JSON（用于调试/后台）
- `GET /healthz`：健康检查
- `GET /metrics`：Prometheus 指标（可选但强烈建议）

后台：

- `GET /admin`：后台首页（统计概览）
- `GET /admin/images`：图片管理
- `POST /admin/images/import`：批量导入 URL（热更新）
- `POST /admin/images/:id/disable` / `enable` / `delete`：操作

### 6.3 查询参数（强筛选：对标 waifu.im 语义）

建议参数（MVP → 完整体可逐步实现）：

- 分级：
  - `r18=0|1|2|any`（0 全年龄，1 R18，2 R18G，any 不筛）
- 方向/尺寸：
  - `orientation=portrait|landscape|square|any`
  - `min_width=...`
  - `min_height=...`
  - `min_pixels=...`（= width*height）
- 标签：
  - `included_tags=tag1,tag2`（AND：必须同时包含）
  - `excluded_tags=tag3,tag4`
- 作者/作品：
  - `user_id=...`
  - `illust_id=...`
- 行为：
  - `format=image|json`（默认 image）
  - `redirect=0|1`（默认 0）
  - `attempts=3`（一次请求内部换图重试次数，建议 1..10）
  - `seed=...`（可选：用于复现随机，便于排障/缓存）

### 6.4 JSON 返回建议格式（图床风格）

```json
{
  "id": 12345,
  "illust_id": 987654321,
  "page_index": 0,
  "r18": false,
  "width": 2480,
  "height": 3508,
  "orientation": "portrait",
  "tags": ["tagA", "tagB"],
  "author": { "user_id": 112233, "name": "someone" },
  "urls": {
    "proxy": "https://your.domain/987654321-1.jpg",
    "origin": "https://i.pximg.net/img-original/img/....jpg"
  },
  "cache": { "max_age": 31536000 },
  "debug": { "picked_by": "random_key", "attempt": 1 }
}
```

---

## 7. 核心逻辑伪代码（稳健性：重试 + 换图 + 自愈 + 热更新）

### 7.1 Pixiv 原生 URL 解析（导入的基础）

大部分 Pixiv 原图 URL 含 `.../{illustId}_p{page}.{ext}`，可解析出 illustId/page/ext：

```pseudo
function parsePixivUrl(url):
  m = regexMatch(url, /(\d+)_p(\d+)(?:_[^.]*)?\.(jpg|jpeg|png|gif|webp)/i)
  if !m: return error("unsupported_url")
  return { illustId: int(m[1]), pageIndex: int(m[2]), ext: lower(m[3]) }
```

### 7.2 热更新导入（同步写 DB + 异步补全元信息）

```pseudo
POST /admin/images/import
  urls = parseTextareaOrUpload()
  for url in urls:
    parsed = parsePixivUrl(url)
    upsert images(illust_id, page_index) with {
      original_url: url,
      ext: parsed.ext,
      status: active,
      random_key: random()
    }
    enqueue job hydrate_metadata(illust_id)
```

元信息补全任务：

```pseudo
job hydrate_metadata(illust_id):
  detail = pixivApi.illustDetail(illust_id)   # 冷路径：需要 access token
  for each page:
    update images set width,height,x_restrict,user,tags,original_url=detail.original_url_of_page
  sync tags table + image_tags relation
```

### 7.3 随机挑图 + 代理（失败换图重试，避免用户直接见到错误）

```pseudo
GET /random?filters...
  attempts = clamp(query.attempts, 1..10) default 3

  for i in 1..attempts:
    record = db.pickRandom(filters)  # random_key/索引命中
    if !record: break

    if query.redirect == 1:
      metrics.success++
      return 302 to record.proxy_path

    result = proxyStream(record.original_url)
    if result.ok:
      metrics.success++
      return stream

    metrics.fail++
    db.markFail(record.id, result.error)
    if is404or403(result): maybe enqueue heal_url(record.illust_id)

  return friendlyFallback()
```

### 7.4 URL 自愈（让 broken 图有机会自动恢复）

```pseudo
job heal_url(illust_id):
  detail = pixivApi.illustDetail(illust_id)
  for each page:
    if db has image(illust_id,page):
      db.updateOriginalUrlIfChanged(...)
      db.setStatusActiveIfWasBroken(...)
```

---

## 8. 管理后台（不停机热更新 + 统计 + 可维护）

### 8.1 后台实现路线（建议先快后优）

路线 A（最快落地）：AdminJS

- 快速获得 CRUD、过滤、分页、编辑、删除
- 适合早期快速验证“热更新/管理/状态机/筛选字段”

路线 B（定制体验更强）：自研后台（SPA + REST）

- 更适合复杂导入（预览/校验/去重/任务进度）、统计图表、权限模型

### 8.2 后台功能清单（对齐你的需求）

图片库管理：

- 列表：总数、active/disabled/broken 数量
- 单条详情：原始 URL、代理 URL、标签、作者、尺寸、失败次数、最近失败原因
- 操作：启用/禁用/删除（建议软删或 status=disabled）

批量导入（热更新核心）：

- textarea 粘贴、文件上传（每行一个 URL）
- 去重策略：`(illust_id, page_index)` 唯一
- 导入后异步补全元信息（队列任务）

统计（最小可用 → 完整体）：

- 请求总数、成功率、失败率
- 延迟：P50/P90/P95
- broken 占比、近 24h top 错误原因
- 资源：CPU/内存（简版也可：仅展示 Node 进程内存）

安全：

- 后台必须鉴权（最低：`ADMIN_TOKEN`；更好：账号+session）
- 对公网 API 必须限流（IP/Key 维度）

---

## 9. 稳健性与性能（低配抗大流量的工程细节）

### 9.1 性能优先级（按收益排序）

1. **把 Pixiv API 从热路径移走**（这是能否“扛巨大请求量”的关键）
2. `/random` 走 **302 重定向**（图片带宽交给 CDN/缓存）
3. DB 随机挑图走索引（random_key 或 TABLESAMPLE 降级）
4. 代理请求使用 keep-alive、流式转发（现有实现方向正确）
5. 限流 + 熔断 + 退避重试（保护自己与上游）

### 9.2 分层重试策略（避免“无脑重试”）

- 网络/超时类：axios-retry（少量重试、指数退避）
- 业务类（图失效）：当次请求内部“换图重试”（attempts 次）
- 上游整体异常：熔断器 opossum（快速失败/降级，避免雪崩）

### 9.3 图片变换（若要做 w/h/crop）：必须签名

若引入 imgproxy：

- 只在 JSON 返回中给出签名后的 imgproxy URL
- 或后台生成变换 URL，前台不可自由组合参数

否则极易被 DoS（任意尺寸/任意格式请求）。

---

## 10. 迭代路线图（强烈建议分阶段，避免一次性大重构）

### 阶段 1：MVP（尽快可用）

- 上 DB（建议直接 PostgreSQL）
- 实现 `GET /random`（基础筛选：orientation + min_width/min_height + r18）
- 后台最小功能：导入 URL、删除/禁用、查看总数
- 稳健性：失败换图重试 + broken 标记 + 冷却时间

### 阶段 2：强筛选（Pixiv 元信息驱动）

- 入库/后台任务：拉取 Pixiv 元信息写入 DB（作者/标签/R18/宽高等）
- 支持 `included_tags/excluded_tags`、`user_id`
- JSON 返回结构标准化

### 阶段 3：工程化（高并发、可观测、可运维）

- `/metrics` + 仪表盘
- 熔断/重试体系化（opossum + p-retry + axios-retry）
- 随机算法优化与降级（random_key + TABLESAMPLE）
- 更完整的后台统计与审计日志

### 阶段 4（可选）：图床级能力

- 引入 imgproxy（签名 URL）
- CDN 策略完善（random no-store、图片长缓存）

---

## 11. 风险与合规（必须写清楚，避免项目“能跑但不可用”）

1) 版权与条款
- Pixiv 图片涉及作者版权与平台条款；你应确保对外提供服务的内容在授权/合法范围内。
- 必须提供后台“禁用/下架”机制，便于合规处理。

2) R18 内容
- 建议默认 `r18=0`（全年龄），并在后台清晰区分/统计 R18/R18G。

3) Token 安全
- refresh_token 属于敏感信息，必须仅服务端保存，并支持轮换。
- 建议：后台导入/日志中严禁输出完整 token。

---

## 12. 参考资料（本规划引用的关键学习来源）

随机图片 API（接口与筛选模型）：

- waifu.im Search API：`https://docs.waifu.im/reference/api-reference/search`
- waifu.im Tags：`https://docs.waifu.im/tags`

图片变换（签名 URL，防滥用）：

- imgproxy Signing URL：`https://docs.imgproxy.net/usage/signing_url`
- imgproxy configuration（key/salt）：`https://docs.imgproxy.net/3.25.x/configuration/options`

稳健性（重试/熔断/限流）：

- axios-retry：`https://github.com/softonic/axios-retry`
- p-retry：`https://github.com/sindresorhus/p-retry`
- opossum：`https://github.com/nodeshift/opossum`
- express-rate-limit：`https://github.com/express-rate-limit/express-rate-limit`

数据库随机优化（避免 ORDER BY random）：

- PostgreSQL `TABLESAMPLE`：`https://www.postgresql.org/docs/current/sql-select.html`
- TABLESAMPLE 实测文章：`https://www.redpill-linpro.com/techblog/2021/05/07/getting-random-rows-faster.html`

Pixiv token 获取（refresh token 常用指南）：

- ZipFile Pixiv OAuth Flow：`https://gist.github.com/ZipFile/c9ebedb224406f4f11845ab700124362`

---

## 13. 下一步需要你确认的关键决策（用于落地实施前锁定路线）

为了后续“真正开始改代码”时不走弯路，你需要先确认 3 个选择：

1) 数据库：PostgreSQL（推荐）还是先 SQLite 快速试跑？
2) 后台：先用 AdminJS 快速 CRUD，还是从第一天就自研后台页面？
3) 图片变换：是否需要（w/h/crop/format）？如果需要，是否接受引入 imgproxy 并强制签名？

只要你把这 3 个答案定下来，我就可以基于本规划输出“可执行的逐文件改动清单 + 模块划分 + 表迁移脚本 + 端点契约细化 + 任务队列设计”，再进入实际代码迭代阶段。

