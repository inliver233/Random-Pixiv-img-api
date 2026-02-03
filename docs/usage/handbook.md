# pixivcat-backend 使用手册（超详细版）

> 适用人群：完全没接触过本项目、甚至不熟悉 Docker / Linux 的用户。  
> 目标：你照着本文一步一步复制粘贴，就能在 Ubuntu 22.04 云服务器上 **部署 + 导入图片 + 调用 API + 使用后台**。

本文覆盖：
- 部署（Ubuntu 22.04）：Docker Compose 推荐；裸机部署可选
- 升级/回滚/备份/排错
- API 使用：`/random`、`/i/:id.:ext`、`/images/:id`、`/healthz`、`/metrics`、legacy 兼容路由
- 后台（AdminJS）：每个页面/资源/按钮/字段的使用方法
- 术语/字段/环境变量“使用字典”

相关文档（本文会引用，但你只看这一份也能完整上手）：
- `/random` 参数详解：`docs/api/random.md`
- 后台鉴权与安全说明：`docs/admin.md`
- Ubuntu 22 部署快速版：`docs/deployment/ubuntu22.md`
- 错误码与 request_id：`docs/errors.md`
- 队列（pg-boss）：`docs/queue.md`
- OpenAPI：`docs/openapi/openapi.yaml`

---

## 目录

- 1. 你将得到什么
- 2. 核心概念（先读 2 分钟，后面不迷路）
- 3. 部署方式选择（推荐 Docker）
- 4. Ubuntu 22.04：Docker Compose 部署（一步一步）
- 5. 部署完成后的必做自检（确认你真的跑起来了）
- 6. 导入图片库（否则 `/random` 会 NO_MATCH）
- 7. API 使用（请求格式 + 返回格式 + 示例）
- 8. 后台（AdminJS）使用手册（页面/按钮/字段全讲清）
- 9. 运维：升级、回滚、备份、日志、常见故障排查
- 10. 使用字典（字段/状态/枚举/环境变量全表）

---

## 1. 你将得到什么

本项目是一个 Node.js/Express 后端，目标是：

1) **保持 Pixivcat 兼容路由不回归**（legacy）  
- 单图：`GET /:illustId.:ext`  
- 多图：`GET /:illustId-:pageNumber.:ext`（pageNumber 从 1 开始）  
这些路由保持 **流式代理**（不会把整张图片读到内存）并使用 **长缓存**。

2) 新增“随机二次元图片 API”（核心）  
- `GET /random`：默认返回图片流；`format=json` 返回 JSON；`redirect=1` 返回 302 跳转到稳定 URL  
- 强筛选：`r18`、`orientation`、`min_width/min_height/min_pixels`、`included_tags/excluded_tags`、`user_id`、`illust_id`、`seed`、`attempts`
- 稳定图片：`GET /i/:id.:ext`（长缓存，适合 CDN）

3) 后台（AdminJS）  
- `GET /admin`：管理后台（Dashboard + Images + Imports + Tags + AdminAudit）
- 支持启用/禁用/软删图片、查看统计面板、查看导入记录与审计日志

4) 可观测  
- `GET /metrics`：Prometheus 指标
- 每个请求都有 `request_id`（响应头 `X-Request-Id`），日志/异步任务可串联排障

---

## 2. 核心概念（先读 2 分钟，后面不迷路）

### 2.1 两类 URL：随机入口 vs 稳定 URL

- `/random`：每次都可能返回不同图片  
  - 响应头强制 `Cache-Control: no-store`（禁止缓存）
  - 适合“抽卡/随机”

- `/i/:id.:ext`：**稳定图片 URL**（id 是数据库里的 Image 记录 id，不是 Pixiv illust_id）  
  - 响应头是长缓存（`Cache-Control: max-age=31536000, public`）
  - 适合 CDN 缓存、做“稳定外链”

推荐生产用法：让客户端访问 `/random?redirect=1`，服务端 302 跳到 `/i/...`，这样：
- `/random` 不缓存（随机）
- `/i/...` 可缓存（稳定）

### 2.2 三个必须的基础依赖

要“完整功能”可用（随机 API + 后台 + 队列），你必须有：
- PostgreSQL（存图片库与状态机；pg-boss 也依赖 Postgres）
- Memcached（Pixiv detail 缓存；减少上游压力）
- Pixiv refresh token（`REFRESH_TOKENS`，轮换获取 access token）

说明：
- 仅想跑 legacy 路由也需要 `REFRESH_TOKENS + Memcached`；但不配置 Postgres 时 `/random`/`/admin`/`/i` 等功能会不可用或报错。

### 2.3 反代场景：`TRUST_PROXY` 非常重要

如果你在前面加了 Nginx/Caddy/Cloudflare 等反代，必须设置：

```bash
TRUST_PROXY=1
```

否则：
- 限流可能按“代理 IP”计算（导致所有人共享同一个限流桶）
- 后台 `ADMIN_IP_ALLOWLIST` 也可能拿到代理 IP（导致误放行/误拦截）

---

## 3. 部署方式选择（推荐 Docker）

### 方案 A：Docker Compose（推荐）

优点：
- 一键启动 Postgres + Memcached + Backend
- 迁移（Prisma migrate deploy）也可以容器内 one-off 跑
- 升级/回滚/备份流程清晰

你将使用的文件：
- `docker-compose.yml`（单文件：生产推荐配置 + 内置 `migrate` 一次性任务）
- `docker-compose.prod.yml`（可选/历史 overlay：保留兼容旧脚本；新部署不需要）
- `Dockerfile`（多阶段构建 + `migrator` stage）

### 方案 B：裸机部署（不使用 Docker）

适合你已经熟悉 Node/Postgres/Memcached，并愿意自己维护 systemd 服务。  
本文也提供步骤，但推荐先用 Docker 跑通再考虑裸机。

---

## 4. Ubuntu 22.04：Docker Compose 部署（一步一步）

> 以下步骤假设你在 Ubuntu 22.04 上操作，并且有一个普通用户（非 root）可以 sudo。

### 4.1 服务器准备（建议照做）

1) 更新系统：

```bash
sudo apt-get update
sudo apt-get upgrade -y
```

2) 安装基础工具：

```bash
sudo apt-get install -y git curl ca-certificates openssl
```

3) 防火墙（可选但建议）：只放行 22/80/443（如果你直接暴露 3000，就把 3000 也放行，但不推荐）

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

### 4.2 安装 Docker + Compose Plugin

（推荐按 Docker 官方文档安装；这里给一个 apt 快速装的方式）

```bash
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

### 4.3 拉取代码并固定到 `test` 分支

```bash
git clone <你的仓库地址>
cd pixivcat-backend
git checkout test
```

建议：生产部署固定到某个 commit（便于回滚）：

```bash
git rev-parse HEAD
```

### 4.4 创建 `.env`（最关键的一步）

`docker-compose.yml` 使用 `.env` 做变量替换。请在仓库根目录创建 `.env`（不要提交到 git）。

#### 4.4.1 最小可运行（不建议生产，但能跑通）

```bash
cat > .env <<'EOF'
BACKEND_PORT=3000
TRUST_PROXY=1

# Pixiv（必填）
REFRESH_TOKENS=["token1","token2"]

# 后台（建议至少设置 token）
ADMIN_TOKEN=change-me-long-random
ADMIN_IP_ALLOWLIST=127.0.0.1,::1

# Postgres（强烈建议改默认口令）
POSTGRES_USER=pixivcat
POSTGRES_PASSWORD=change-me-db-pass
POSTGRES_DB=pixivcat
EOF
```

#### 4.4.2 推荐生产配置（更安全）

1) 生成强随机 token（你可以直接复制输出）：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

2) 用生成的随机值替换下面的 `CHANGE_ME_*`：

```bash
cat > .env <<'EOF'
# ========== 基础 ==========
BACKEND_PORT=3000
TRUST_PROXY=1

# ========== Pixiv ==========
# JSON 数组字符串（不要把真实 token 提交到 git）
REFRESH_TOKENS=["CHANGE_ME_REFRESH_TOKEN_1","CHANGE_ME_REFRESH_TOKEN_2"]

# ========== Admin（强烈建议开启） ==========
ADMIN_TOKEN=CHANGE_ME_ADMIN_TOKEN_64HEX

# 只允许你自己的出口 IP（示例：把 1.2.3.4 换成你的公网出口 IP）
# 如果你没有固定 IP，建议用“堡垒机/内网/VPN”访问后台，或者至少先临时放行再收紧。
ADMIN_IP_ALLOWLIST=1.2.3.4

# （可选）后台 Session 登录（不建议新手上来就开；先用 ADMIN_TOKEN 跑通）
# ADMIN_SESSION_AUTH_ENABLED=1
# ADMIN_SESSION_SECRET=CHANGE_ME_SESSION_SECRET_64HEX
# ADMIN_SESSION_USER=admin
# ADMIN_SESSION_PASS=pass

# （可选）后台写操作限流（防爆破/误操作）
# ADMIN_RATE_LIMIT_ENABLED=1
# ADMIN_RATE_LIMIT_MAX=20
# ADMIN_RATE_LIMIT_WINDOW_MS=60000

# （可选）后台 CSRF（建议配合 cookie/session；反代 + HTTPS 时可能需要设置 allowed origins）
# ADMIN_CSRF_ENABLED=1
# ADMIN_CSRF_ALLOWED_ORIGINS=https://example.com

# ========== Postgres ==========
POSTGRES_USER=pixivcat
POSTGRES_PASSWORD=CHANGE_ME_DB_PASS
POSTGRES_DB=pixivcat

# ========== 服务限流（对外 API） ==========
# RATE_LIMIT_ENABLED=1
# RATE_LIMIT_MAX=60
# RATE_LIMIT_WINDOW_MS=60000
# RATE_LIMIT_API_KEYS=key1,key2
# RATE_LIMIT_MAX_API_KEY=300

# ========== Metrics ==========
# METRICS_ENABLED=1
# METRICS_ROUTE=/metrics
# （可选）给 /metrics 加 Basic Auth
# METRICS_BASIC_AUTH_USER=metrics
# METRICS_BASIC_AUTH_PASS=change-me

# ========== 日志 ==========
# LOG_LEVEL=info
EOF
```

### 4.5 一键启动（包含 DB 迁移）

> 一条命令启动：Postgres + Memcached + migrate（Prisma migrate deploy）+ backend。

```bash
docker compose up -d --build
docker compose ps
```

说明：
- `migrate` 是一次性任务容器：跑完迁移会正常退出（`Exited (0)`），这是预期行为。
- 你可以反复执行 `docker compose up -d --build`（升级/重启时也安全）。

### 4.6（可选）确认 Postgres / 手动执行迁移

确认 Postgres ready：

```bash
docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-pixivcat}"
```

只手动执行迁移（通常不需要，因为 `up` 会自动执行）：

```bash
docker compose run --rm migrate
```

### 4.7 查看日志

```bash
docker compose logs -f backend
```

### 4.8（强烈推荐）反向代理 + HTTPS（Nginx + Let's Encrypt）

> 目的：对外只暴露 80/443，把 backend 的 3000 端口藏在内网/本机；同时启用 HTTPS，避免后台 cookie 在生产环境被 Secure 限制导致登录异常。

#### 4.8.1 准备域名解析

在你的域名服务商控制台，把域名 A 记录指向你的云服务器公网 IP，例如：
- `example.com -> 1.2.3.4`

等待解析生效后，在服务器上验证：

```bash
dig +short example.com
```

#### 4.8.2 安装 Nginx

```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
sudo systemctl status nginx --no-pager
```

#### 4.8.3 写入 Nginx 反代配置

把 `example.com` 换成你的真实域名：

```bash
sudo tee /etc/nginx/sites-available/pixivcat-backend.conf >/dev/null <<'EOF'
server {
  listen 80;
  server_name example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # 重要：长连接/流式代理相关（可选，但建议）
    proxy_buffering off;
    proxy_request_buffering off;
  }
}
EOF
```

启用站点并 reload：

```bash
sudo ln -sf /etc/nginx/sites-available/pixivcat-backend.conf /etc/nginx/sites-enabled/pixivcat-backend.conf
sudo nginx -t
sudo systemctl reload nginx
```

#### 4.8.4 申请 HTTPS 证书（Let's Encrypt）

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com
```

完成后访问：
- `https://example.com/healthz`

#### 4.8.5 配置 TRUST_PROXY（必须）

反代后必须在 `.env` 设置：

```bash
TRUST_PROXY=1
```

否则后台 allowlist/限流会拿到代理 IP。

#### 4.8.6（可选）后台 CSRF 在反代 + HTTPS 下的配置

如果你启用了 `ADMIN_CSRF_ENABLED=1`，并且出现 “Origin mismatch”，可以设置：

```bash
ADMIN_CSRF_ALLOWED_ORIGINS=https://example.com
```

### 4.9（强烈建议）不要把 3000 端口暴露到公网

你至少应做到其中一种：

1) 云厂商安全组：关闭/不放行 3000  
2) UFW：拒绝外网访问 3000（如果你只用 Nginx 暴露 80/443）

```bash
sudo ufw deny 3000/tcp
sudo ufw status
```

> 注意：Docker 的端口映射可能绕开 UFW（取决于宿主机配置）。最稳妥的做法是：云安全组层面关闭 3000。

---

## 5. 部署完成后的必做自检（确认你真的跑起来了）

假设你把 backend 映射到了宿主机 `BACKEND_PORT=3000`：

> 本文中出现的 `${ADMIN_TOKEN}` / `${BACKEND_PORT}` 等写法是“示意变量”。  
> - 你可以手动把它们替换成实际值（最简单）  
> - 或者按下面方式把 `.env` 里的值临时导入到当前 shell（方便直接复制粘贴命令）

```bash
# 方式 A：手工 export（推荐新手，最直观）
export BACKEND_PORT=3000
export ADMIN_TOKEN='把这里替换成你的 ADMIN_TOKEN'

# 方式 B：从 .env 读取（可选；确保 .env 里不含空格/特殊字符行）
# set -a; source .env; set +a
```

1) 健康检查（200 表示 db/memcached/queue 都 OK；503 表示其中有失败项）：

```bash
curl -i "http://127.0.0.1:3000/healthz"
```

2) 指标：

```bash
curl -s "http://127.0.0.1:3000/metrics" | head
```

3) 后台鉴权检查（没有 token 应 401；带 token 应能返回 HTML）：

```bash
curl -i "http://127.0.0.1:3000/admin"
curl -i -H "Authorization: Bearer ${ADMIN_TOKEN}" "http://127.0.0.1:3000/admin" | head
```

4) `/random`（首次 DB 为空时，可能 404 `NO_MATCH`，这是正常的——下一章会教你导入）：

```bash
curl -i "http://127.0.0.1:3000/random?format=json"
```

如果返回：
- `200`：你已经有数据（或你导入过）
- `404` 且 `code=NO_MATCH`：说明图片库为空/过滤条件太严格，继续下一章导入即可

---

## 6. 导入图片库（否则 `/random` 会 NO_MATCH）

本项目“随机图片”来自数据库 `images` 表。你必须先导入 Pixiv 原图 URL 列表。

导入入口（管理 API）：
- `POST /admin/images/import`（支持 textarea 或文件上传）

### 6.1 你要准备的 URL 格式

你需要的是 Pixiv 原图（pximg）URL，通常长这样（示例）：

```
https://i.pximg.net/img-original/img/2020/01/01/00/00/00/123456789_p0.jpg
https://i.pximg.net/img-original/img/2020/01/01/00/00/00/123456789_p1.jpg
```

一行一个 URL。允许空行；允许用 `#` 开头写注释行。

### 6.2 方法 A：用 curl 一键导入（推荐，最稳）

1) 准备一个文本文件 `urls.txt`（一行一个 URL）：

```bash
cat > urls.txt <<'EOF'
# one per line
https://i.pximg.net/img-original/img/2020/01/01/00/00/00/123456789_p0.jpg
EOF
```

2) 发送导入请求（multipart/form-data）：

```bash
curl -sS \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -F "file=@urls.txt" \
  "http://127.0.0.1:3000/admin/images/import" | jq .
```

如果你没有 `jq`，可以先安装：

```bash
sudo apt-get install -y jq
```

### 6.3 方法 B：直接用 textarea 字段导入（无需文件）

```bash
curl -sS \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -F "urls=https://i.pximg.net/img-original/img/2020/01/01/00/00/00/123456789_p0.jpg" \
  "http://127.0.0.1:3000/admin/images/import" | jq .
```

支持的 textarea 字段别名：`urls` / `text` / `textarea` / `input`。

### 6.4 预览/干跑（dry-run）

你可以先预览，不写入 DB：

```bash
curl -sS \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -F "urls=https://i.pximg.net/img-original/img/2020/01/01/00/00/00/123456789_p0.jpg" \
  -F "preview=1" \
  "http://127.0.0.1:3000/admin/images/import" | jq .
```

### 6.5 导入成功后你应该看到什么

导入响应会包含：
- `import_id`：本次导入记录 ID（字符串形式的 bigint）
- `success/failed`：成功/失败条数
- `results[]`：每一行 URL 的解析结果（illust_id/page_index/ext/original_url/proxy_path）
- `errors[]`：失败行（line/url/code/message）
- `enqueued.hydrate_metadata`：是否触发了元信息补全任务（队列）

导入后建议立刻验证：

```bash
curl -i "http://127.0.0.1:3000/random?format=json"
curl -i "http://127.0.0.1:3000/random?redirect=1"
```

### 6.6 方法 C：用 Postman（GUI）导入（适合完全不想写命令的人）

1) 打开 Postman，点击 **New** → **HTTP Request**
2) 选择 Method：`POST`
3) URL 填：
- 如果直连：`http://你的服务器IP:3000/admin/images/import`
- 如果反代：`https://example.com/admin/images/import`

4) 点击 **Headers**，新增一行：
- Key：`Authorization`
- Value：`Bearer <你的ADMIN_TOKEN>`

5) 点击 **Body**
- 选择 `form-data`
- 选择一种方式填写：
  - 方式 A（文本）：Key=`urls`，Type=`Text`，Value 粘贴多行 URL（每行一个）
  - 方式 B（文件）：Key=`file`，Type=`File`，选择你的 `urls.txt`

6) 点击 **Send**

7) 你应该在 Response 里看到 JSON：
- `ok: true`
- `success`/`failed`
- `results[]` 与 `errors[]`

常见坑：
- Header 的 Value 必须是 `Bearer 空格 token`（很多人忘了空格）
- 你如果启用了 `ADMIN_IP_ALLOWLIST`，必须从 allowlist 内的 IP 发请求（反代场景要 `TRUST_PROXY=1`）

### 6.7 在后台查看导入记录（Imports）

导入（非 preview）会写入 `Import` 记录。你可以在后台看到：

1) 打开后台：
- `https://example.com/admin?token=<ADMIN_TOKEN>`（浏览器第一次推荐这样进）

2) Sidebar 点击 **Imports**
- 你会看到导入记录列表（按时间）

3) 点击某条记录进入详情（Show）
- `detail` 字段里会有更详细的 breakdown（dedup、错误样本、队列入列信息等）

### 6.8 常见导入失败原因与处理

1) `UNSUPPORTED_URL` / `invalid_url`  
- 说明：你贴的不是 Pixiv 原图（pximg）URL，或 URL 形态不符合解析规则  
- 处理：确保 URL 是 `i.pximg.net/img-original/.../<illustId>_p<index>.<ext>`

2) `MAX_LINES_EXCEEDED`  
- 说明：你设置了 `ADMIN_IMPORT_MAX_LINES`，本次提交行数超限  
- 处理：把输入拆成多次提交，或调大/关闭该限制

3) `PAYLOAD_TOO_LARGE`（413）  
- 说明：上传文件太大，超过 `ADMIN_IMPORT_MAX_FILE_BYTES`  
- 处理：拆分文件或调大限制

---

## 7. API 使用（请求格式 + 返回格式 + 示例）

> Base URL：假设你的服务对外是 `http://<host>:3000` 或 `https://example.com`（反代）。

### 7.1 GET /random（随机图片）

默认行为：返回图片二进制（流式），并强制 `Cache-Control: no-store`。

#### 7.1.1 三种返回模式

1) 图片流（默认）：

```bash
curl -L "http://127.0.0.1:3000/random" -o out.bin
file out.bin
```

2) JSON（`format=json`）：

```bash
curl -s "http://127.0.0.1:3000/random?format=json" | jq .
```

3) 302 重定向（`redirect=1`）：Location 指向稳定 URL `/i/:id.:ext`

```bash
curl -i "http://127.0.0.1:3000/random?redirect=1"
curl -L "http://127.0.0.1:3000/random?redirect=1" -o out.bin
```

#### 7.1.2 请求参数（完整表）

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `format` | `image \| json` | `image` | `json` 返回结构化 JSON |
| `redirect` | `0 \| 1` | `0` | `1` 返回 302（优先于 format） |
| `attempts` | `1..10` | `3` | 随机挑选失败时的重试次数（越大越耗 DB/上游） |
| `seed` | string | 无 | 固定随机序列（相同 seed 可复现结果序列，便于回归） |
| `r18` | `0 \| 1 \| 2` | `0` | 0=全年龄，1=R18，2=R18G |
| `orientation` | `portrait \| landscape \| square \| any` | `any` | 方向筛选（依赖 width/height 元信息） |
| `min_width` | int | 无 | 最小宽度 |
| `min_height` | int | 无 | 最小高度 |
| `min_pixels` | int | 无 | 最小像素数（width*height） |
| `included_tags` | string（`|` 分隔） | 无 | 必须同时包含这些标签（AND） |
| `excluded_tags` | string（`|` 分隔） | 无 | 不能包含这些标签（NOT） |
| `user_id` | int | 无 | Pixiv 用户 ID 精确匹配 |
| `illust_id` | int | 无 | Pixiv 作品 ID 精确匹配 |

示例（可直接复制）：

```bash
# 竖图 + 最小宽高
curl -I "http://127.0.0.1:3000/random?orientation=portrait&min_width=1080&min_height=1920"

# 只要全年龄（默认就是 0）+ 可复现 seed
curl -s "http://127.0.0.1:3000/random?format=json&seed=demo" | jq .

# 排除某些 tag（OR/NOT 语义）
curl -s "http://127.0.0.1:3000/random?format=json&excluded_tags=r18|r18g" | jq .

# 只要某个作者的图
curl -s "http://127.0.0.1:3000/random?format=json&user_id=12345678" | jq .

# 生产推荐：redirect=1
curl -i "http://127.0.0.1:3000/random?redirect=1"
```

#### 7.1.3 JSON 返回格式（字段解释）

`format=json` 时返回 `RandomJsonResponse`（见 `src/contracts/randomResponse.ts`），示例结构：

```json
{
  "id": 1,
  "illust_id": 123456789,
  "page_index": 0,
  "r18": false,
  "width": 1200,
  "height": 1800,
  "orientation": "portrait",
  "tags": ["tag1", "tag2"],
  "author": { "user_id": 1234, "name": "someone" },
  "urls": { "proxy": "/i/1.jpg", "origin": "https://i.pximg.net/..." },
  "cache": { "max_age": 31536000 },
  "debug": { "picked_by": "random_key", "attempt": 3 }
}
```

字段说明：
- `id`：数据库 Image 记录 id（用于 `/i/:id.:ext` 与 `/images/:id`）
- `illust_id/page_index`：对应 Pixiv 作品与页码（p0 对应 page_index=0）
- `r18`：根据 `xRestrict` 计算（>0 即 true）
- `urls.proxy`：稳定 URL（适合缓存/外链）
- `urls.origin`：Pixiv 原图 URL（日志/错误里会自动脱敏去掉 query/hash）
- `debug.picked_by`：随机策略（默认 `random_key`；压力大时可能用 `tablesample`）

#### 7.1.4 常见错误与排查

1) 返回 404 且 `code=NO_MATCH`：  
- 说明：当前筛选条件下没有可用图片（常见原因：你没导入、或者过滤太严）  
- 处理：先导入图片；或放宽条件；或提高 `attempts`（上限 10）

2) 返回 400 `BAD_REQUEST`：  
- 说明：参数非法（例如 `attempts=abc`、`r18=` 空值、`seed` 为空）  
- 处理：按 `docs/api/random.md` 修正参数

### 7.2 GET /i/:id.:ext（稳定图片 URL，长缓存）

用途：给 CDN/客户端一个稳定 URL。  
特点：
- 响应头长缓存（`Cache-Control: max-age=31536000, public`）
- 流式代理，不把图片读入内存
- 上游 403/404 可能触发 `heal_url` 自愈任务（刷新 DB 中 original_url/ext）

示例：

```bash
# 假设你从 /random?redirect=1 得到了 /i/123.jpg
curl -I "http://127.0.0.1:3000/i/123.jpg"
curl -L "http://127.0.0.1:3000/i/123.jpg" -o out.jpg
```

### 7.3 GET /images/:id（查看单条图片元信息）

用途：拿到 DB 里某条 Image 的“元信息 + tags + 状态”。  
注意：该接口 `Cache-Control: no-store`（避免读到过期状态）。

```bash
curl -s "http://127.0.0.1:3000/images/1" | jq .
```

### 7.4 GET /healthz（健康检查）

```bash
curl -s "http://127.0.0.1:3000/healthz" | jq .
```

字段说明：
- `db.ok`：Postgres 是否可用
- `memcached.ok`：Memcached 是否可用
- `queue.ok`：pg-boss 队列是否可用
- `ok=true`：三者都 OK

### 7.5 GET /metrics（Prometheus）

默认开启（`METRICS_ENABLED=1`）。建议生产对 `/metrics` 加 Basic Auth：

```bash
METRICS_BASIC_AUTH_USER=metrics
METRICS_BASIC_AUTH_PASS=change-me
```

请求示例：

```bash
curl -u "metrics:change-me" "http://127.0.0.1:3000/metrics"
```

### 7.6 legacy Pixivcat 兼容路由（重要：保持不回归）

单图：

```bash
curl -I "http://127.0.0.1:3000/12345678.jpg"
```

多图（第 1 张，pageNumber 从 1 开始）：

```bash
curl -I "http://127.0.0.1:3000/12345678-1.jpg"
```

注意：
- 这些路由仍然会访问 Pixiv 上游；可能遇到上游限流或作品不可见等情况（会返回 HTML 错误页 + request_id）

---

## 8. 后台（AdminJS）使用手册（页面/按钮/字段全讲清）

后台入口：`/admin`

### 8.1 进入后台（鉴权方法）

后台默认使用 `ADMIN_TOKEN` 鉴权（推荐，最简单）：

方式 1：浏览器地址栏一次性登录（推荐新手）
- 打开：`https://example.com/admin?token=<ADMIN_TOKEN>`
- 成功后会写入 `admin_token` cookie，并重定向到无 token 的 URL
- 之后你直接打开 `/admin` 就可以进入

方式 2：HTTP Header（适合 curl/Postman）

```bash
curl -i -H "Authorization: Bearer ${ADMIN_TOKEN}" "http://127.0.0.1:3000/admin"
```

方式 3：Header `X-Admin-Token`（兼容）

```bash
curl -i -H "X-Admin-Token: ${ADMIN_TOKEN}" "http://127.0.0.1:3000/admin"
```

### 8.2 强烈建议加 IP 白名单（ADMIN_IP_ALLOWLIST）

后台是高权限入口。建议至少配置：

```bash
ADMIN_IP_ALLOWLIST=你的公网出口IP
TRUST_PROXY=1
```

说明：
- 支持分隔符：逗号`,` / 空格 / `|`
- 支持 IPv4 CIDR：如 `10.0.0.0/8`
- 未设置 allowlist：不启用 IP 限制（不推荐）

### 8.3 Dashboard（仪表盘页面）

进入 `/admin` 默认 landing 是 Dashboard。你会看到几个卡片/区块：

- Summary：Images 总数/Active/Disabled/Broken、内存占用、运行时间
- Process：uptime、RSS/heap 等
- Images：各状态统计、broken_ratio 等
- Imports：导入总数、24h 导入数、最近一次导入时间
- Metrics：是否启用、当前进程注册的 metric 名称列表（可展开）
- Prometheus（可选）：如果你配置了 `PROMETHEUS_URL`，会展示 24h 请求量、top errors、p50/p90/p95 延迟

常见用法：
- 你导入/禁用/启用图片后，刷新 Dashboard，数字应随之变化

### 8.4 Images 资源（核心：启用/禁用/软删）

Sidebar 点击 **Images**（资源名一般就是 Images）。

#### 8.4.1 列表页（List）你会看到的列

默认列表列（见 `src/admin/resources/images.ts`）：
- `id`
- `illustId`
- `pageIndex`
- `status`（active/disabled/broken）
- `xRestrict`（0/1/2）
- `width`
- `height`
- `userId`

#### 8.4.2 过滤器（Filters）怎么用

Images 支持过滤字段（常用）：
- `status`：active/disabled/broken
- `illustId`：精确筛选某个作品
- `userId` / `userName`：筛选作者
- `xRestrict`：全年龄/R18/R18G
- `orientation`：portrait/landscape/square（依赖元信息补全）
- `minWidth` / `minHeight`：只看大图
- `tag`：按 tag 名筛选（会联表）

新手建议：
- 先用 `status=active` 看当前能被 `/random` 命中的图片
- `tag` 和尺寸过滤会更耗查询，数据量大时建议谨慎叠加

#### 8.4.3 记录页（Show）上的按钮（重点）

Image 记录页会出现一些“记录级动作按钮”（Record actions）：

- **Disable**：把该图片 `status` 改成 disabled  
  - disabled 的图片不会被 `/random` 选中

- **Enable**：把图片恢复为 active  

- **Delete**：当前 MVP 为 **软删**（soft delete）  
  - 实际行为：把 status 设为 disabled（记录仍在 DB）

按钮显示逻辑：
- active：可看到 Disable、Delete
- disabled：可看到 Enable（Delete 可能隐藏）

#### 8.4.4 资源级动作：StatusCounts

Images 资源还提供一个“资源级动作”（Resource action）：
- **statusCounts**：会统计 total/active/disabled/broken 以及 xRestrict 分布，并用 AdminJS notice 显示

通常它会出现在资源页面顶部的动作菜单/按钮中（不同 AdminJS 版本 UI 位置略有差异）。

### 8.5 Imports 资源（导入记录查看）

每次 `POST /admin/images/import`（非 preview/dry_run）会写入一条 Import 记录：
- list 列：`id/createdAt/createdBy/source/total/success/failed`
- show 页额外有 `detail`（JSON）：包含 dedup/错误样本/队列入列情况等

你可以用 Imports：
- 回看某次导入为什么失败（errors[]）
- 记录导入来源与时间（审计）

### 8.6 AdminAudit 资源（审计日志，建议开启）

如果 `ADMIN_AUDIT_VIEW_ENABLED` 未显式关闭（默认 true），你会在 Sidebar 看到 AdminAudit：

它会记录：
- 谁做的（actor）
- 做了什么（action）
- 影响哪个资源/record（resource/recordId）
- fromStatus/toStatus（比如启用/禁用/软删）
- request_id、ip、user_agent 等排障信息

常见用法：
- 你怀疑某张图被禁用了：到 AdminAudit 里搜 recordId 或 requestId

### 8.7 Tags 资源（标签表）

Tags 是图片标签表（`tags`），通常由元信息补全任务写入。  
新手建议：
- 不要手动随意删改 tag（会影响筛选）；如果需要校正翻译字段（translatedName）再考虑编辑

### 8.8 管理 API（不依赖 AdminJS UI 的按钮）

这些接口属于 `/admin` 下的管理 API，一样受 `ADMIN_TOKEN` 保护。

#### 8.8.1 图片启用/禁用/删除（API 方式）

```bash
curl -s -H "Authorization: Bearer ${ADMIN_TOKEN}" -X POST "http://127.0.0.1:3000/admin/images/1/disable" | jq .
curl -s -H "Authorization: Bearer ${ADMIN_TOKEN}" -X POST "http://127.0.0.1:3000/admin/images/1/enable" | jq .
curl -s -H "Authorization: Bearer ${ADMIN_TOKEN}" -X POST "http://127.0.0.1:3000/admin/images/1/delete" | jq .
```

返回示例：

```json
{ "ok": true, "id": "1", "from_status": 1, "to_status": 2, "status": "disabled" }
```

---

## 9. 运维：升级、回滚、备份、日志、常见故障排查

### 9.1 常用运维命令（Docker Compose）

```bash
# 看容器状态
docker compose ps

# 看 backend 日志
docker compose logs -f backend

# 重启 backend
docker compose restart backend

# 进入 postgres 容器
docker compose exec postgres sh
```

### 9.2 升级（推荐流程）

```bash
git checkout test
git pull

docker compose up -d --build
```

### 9.3 回滚（最简单方法：回到旧 commit）

```bash
git checkout test
git log --oneline -n 20
git checkout <某个旧commit>

docker compose up -d --build
```

注意：如果你回滚到了旧 schema 版本，DB 迁移可能需要额外处理；建议生产升级前做备份。

### 9.4 备份（pg_dump）

```bash
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-pixivcat}" "${POSTGRES_DB:-pixivcat}" > backup.sql
gzip -9 backup.sql
ls -lh backup.sql.gz
```

恢复（示例，慎用，会覆盖现有数据）：

```bash
gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U "${POSTGRES_USER:-pixivcat}" "${POSTGRES_DB:-pixivcat}"
```

### 9.5 常见故障排查

1) `/healthz` 返回 503：
- 看返回 JSON：是 db/memcached/queue 哪个不 ok
- 常见原因：
  - Postgres 未启动
  - `.env` 里的 `POSTGRES_PASSWORD` 改了但 volume 里还是旧密码（需要重建数据卷或用一致配置）

2) `/random` 返回 404 `NO_MATCH`：
- 你没导入（先导入）
- 你筛选条件太严（先去掉 `min_*`/`included_tags`/`orientation` 试试）

3) `/admin` 401：
- 你没设置 `ADMIN_TOKEN` 或 token 写错
- 你开启了 `ADMIN_IP_ALLOWLIST` 但没放行当前 IP（反代场景要 `TRUST_PROXY=1`）

4) `/metrics` 401：
- 你设置了 `METRICS_BASIC_AUTH_USER/PASS` 但请求没带 basic auth

5) legacy 路由偶发 503（上游限流）：
- 这是 Pixiv 上游限流导致；增加 token 数量/轮换策略可能缓解
- 可以查看日志中的 `code=UPSTREAM_RATE_LIMIT` 与 `request_id`

---

## 10. 使用字典（字段/状态/枚举/环境变量全表）

### 10.1 Image 状态（status）

| 数值 | 文本 | 含义 |
| --- | --- | --- |
| 1 | active | 正常可用，会被 `/random` 选中 |
| 2 | disabled | 禁用（软删后也是 disabled），不会被 `/random` 选中 |
| 3 | broken | 失败/损坏（上游错误/流错误等标记），不会被 `/random` 选中（直到被修复/启用） |

### 10.2 xRestrict（r18）

| 数值 | 含义 |
| --- | --- |
| 0 | 全年龄 |
| 1 | R18 |
| 2 | R18G |
| null | 未补全 |

### 10.3 orientation（方向）

内部存储（int）→ 对外（string）：
- 1 → `portrait`
- 2 → `landscape`
- 3 → `square`
- 其他/空 → `unknown`

### 10.4 环境变量（按功能分组）

> 下表是“最常用”变量。完整变量请以 `src/config/env.ts` 为准。

#### 10.4.1 必需（完整功能）

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `REFRESH_TOKENS` | `["t1","t2"]` | Pixiv refresh token 列表（必填） |
| `MEMCACHED_HOST` | `memcached` | Memcached host（Docker 默认 memcached） |
| `MEMCACHED_PORT` | `11211` | Memcached port |
| `MEMCACHED_NAMESPACE` | `pixiv` | 缓存 key 前缀 |
| `DATABASE_URL` | `postgresql://...` | Postgres 连接串（用于 Prisma + pg-boss） |

#### 10.4.2 反代相关

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `TRUST_PROXY` | `1` | Express `trust proxy` hops（反代场景必须设置） |

#### 10.4.3 后台相关

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | `...` | 后台鉴权 token |
| `ADMIN_IP_ALLOWLIST` | `1.2.3.4,10.0.0.0/8` | 后台 IP 白名单（强烈建议） |
| `ADMIN_SESSION_AUTH_ENABLED` | `1` | 启用 session 登录（可选） |
| `ADMIN_SESSION_SECRET` | `...` | session secret（启用 session 必填） |
| `ADMIN_SESSION_USER`/`PASS` | `admin/pass` | 登录账号密码（启用 session 必填） |
| `ADMIN_CSRF_ENABLED` | `1` | 启用 CSRF（建议配合 cookie/session） |
| `ADMIN_CSRF_ALLOWED_ORIGINS` | `https://example.com` | 反代/HTTPS 终止场景的 allowed origin |

#### 10.4.4 观测与日志

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `METRICS_ENABLED` | `1` | 启用 `/metrics` |
| `METRICS_ROUTE` | `/metrics` | 指标路由（默认 /metrics） |
| `METRICS_BASIC_AUTH_USER/PASS` | `metrics/xxx` | 给 /metrics 加 basic auth（可选） |
| `PROMETHEUS_URL` | `http://prometheus:9090` | Admin Dashboard 读取 Prometheus（可选） |
| `LOG_LEVEL` | `info` | pino 日志级别 |

#### 10.4.5 随机与自愈（高级）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `RANDOM_FAIL_COOLDOWN_MS` | `600000` | 失败冷却窗口（ms） |
| `HEAL_TRIGGER_STATUSES` | `403,404` | /i 上游返回这些状态触发 heal_url |
| `HEAL_TRIGGER_SKIP_IF_RETRY_AFTER` | `true` | 上游带 Retry-After 时不触发自愈（避免限流误判） |
| `HYDRATE_RATE_LIMIT_PER_TOKEN_MS` | `1000` | 冷路径按 token 限速（ms） |
