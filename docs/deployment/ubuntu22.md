# Ubuntu 22.04 云服务器部署与使用教程（推荐 Docker Compose）

目标：在 Ubuntu 22.04 上稳定运行 `pixivcat-backend`（Pixivcat 兼容路由 + 随机二次元图片 API + AdminJS 后台 + /metrics）。

> 说明：本文以 **Docker Compose** 为推荐部署方式；也提供“裸机（不使用 Docker）”方案。

## 0) 必看（安全与默认值）

- `/admin` **强烈建议**：同时启用 `ADMIN_TOKEN` + `ADMIN_IP_ALLOWLIST`，并放在反代后（不要直接公网暴露）。
- 反代（Nginx/Caddy/Traefik）场景务必设置：`TRUST_PROXY=1`，否则限流与后台 IP allowlist 会看到代理 IP（可能导致限流失效或误放行/误拦截）。
- 合规默认：`/random` 默认 `r18=0`（全年龄）。只有显式传 `r18=1/2` 才会筛出 R18/R18G。
- 生产部署安全清单：见 `docs/deployment/security-checklist.md`。

## 1) 方案 A：Docker Compose（推荐）

### 1.1 安装 Docker（Ubuntu 22.04）

按官方文档安装 Docker Engine + Compose Plugin（推荐）。如果你希望直接用 apt 快速安装，可参考（可能不是最新）：

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

### 1.2 拉取代码（使用 test 分支）

```bash
sudo apt-get install -y git
git clone <your-repo-url>
cd pixivcat-backend
git checkout test
```

### 1.3 准备 `.env`（用于 Compose 变量替换）

`docker-compose.yml` 使用 `${VAR:-default}` 形式从 `.env` 读取配置（`.env` 不要提交到 git）。

在仓库根目录创建 `.env`（示例）：

```bash
cat > .env <<'EOF'
# backend 暴露到宿主机的端口（容器内部固定监听 3000）
BACKEND_PORT=3000

# 反代场景：信任 1 层代理（Nginx/Caddy）
TRUST_PROXY=1

# （可选但强烈推荐）部署追溯：用于 `/healthz` 与 `/version` 的 build.commit
# APP_COMMIT=<git-sha>
# APP_BUILD_TIME=<iso-8601>

# Pixiv（必填；不要提交真实 token）
REFRESH_TOKENS=["token1","token2"]

# Admin（强烈建议设置）
ADMIN_TOKEN=change-me-long-random
# 仅允许你的办公/内网 IP 访问后台（示例：只允许本机与内网段）
ADMIN_IP_ALLOWLIST=127.0.0.1,::1,10.0.0.0/8,192.168.0.0/16,172.16.0.0/12

# Postgres（生产强烈建议改默认口令；改完后无需手动改 DATABASE_URL，compose 会自动拼接）
POSTGRES_USER=pixivcat
POSTGRES_PASSWORD=change-me-db-pass
POSTGRES_DB=pixivcat

# （可选）后台 Session 登录（需要同时设置 secret/user/pass）
# ADMIN_SESSION_AUTH_ENABLED=1
# ADMIN_SESSION_SECRET=change-me-long-random
# ADMIN_SESSION_USER=admin
# ADMIN_SESSION_PASS=pass

# （可选）后台写操作限流
# ADMIN_RATE_LIMIT_ENABLED=1
# ADMIN_RATE_LIMIT_MAX=20
# ADMIN_RATE_LIMIT_WINDOW_MS=60000

# （可选）全局 API 限流（/random /i /images）
# RATE_LIMIT_ENABLED=1
# RATE_LIMIT_MAX=60
# RATE_LIMIT_WINDOW_MS=60000
EOF
```

### 1.4 一键启动（包含 DB 迁移）

> 一条命令启动：Postgres + Memcached + migrate（Prisma migrate deploy）+ backend。

```bash
docker compose up -d --build
docker compose ps
```

说明：
- `migrate` 是一次性任务容器：跑完迁移会正常退出（`Exited (0)`），这是预期行为。
- 你可以反复执行 `docker compose up -d --build`（升级/重启时也安全）。

（可选）确认 Postgres 就绪：

```bash
docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-pixivcat}"
```

（可选）只手动执行迁移（通常不需要）：

```bash
docker compose run --rm migrate
```

健康检查（应返回 200）：

```bash
curl -i "http://127.0.0.1:${BACKEND_PORT:-3000}/healthz"
```

说明：`/healthz` 响应体应包含 `build.version / build.commit / build.build_time`（用于线上版本追溯与排查“旧构建/不一致部署”）。

可选：单独查看版本信息：

```bash
curl -i "http://127.0.0.1:${BACKEND_PORT:-3000}/version"
```

### 1.7 导入图片（否则 /random 可能 NO_MATCH）

`/random` 从数据库图片池中随机挑选；数据库为空时会返回 `NO_MATCH`（404）。

导入方式推荐走后台（见 `docs/admin.md`）：
- 浏览器访问：`http://127.0.0.1:${BACKEND_PORT:-3000}/admin?token=<ADMIN_TOKEN>`
- 在后台使用“Import/导入”功能粘贴 Pixiv 原图 URL（可批量）。

### 1.8 常用验收（部署后自检清单）

```bash
# 1) 健康检查
curl -i "http://127.0.0.1:${BACKEND_PORT:-3000}/healthz"
curl -i "http://127.0.0.1:${BACKEND_PORT:-3000}/version"

# 2) 指标（Prometheus）
# 默认策略：`/metrics` 受保护（不对公网匿名开放），因此可能返回 `401/404`（见 `docs/usage/handbook.md`）。
curl -I "http://127.0.0.1:${BACKEND_PORT:-3000}/metrics"

# 若你配置了 Basic Auth（推荐生产），可用以下方式抓取：
# curl -u "<user>:<pass>" "http://127.0.0.1:${BACKEND_PORT:-3000}/metrics" | head

# 3) /random：JSON（若未导入图片，可能 404 NO_MATCH）
curl -i "http://127.0.0.1:${BACKEND_PORT:-3000}/random?format=json"

# 4) /random：推荐生产用法 redirect=1（302 到稳定 URL）
curl -i "http://127.0.0.1:${BACKEND_PORT:-3000}/random?redirect=1"

# 5) legacy pixivcat 兼容路由（仍走 Pixiv 上游 + 流式代理）
curl -I "http://127.0.0.1:${BACKEND_PORT:-3000}/12345678.jpg"
curl -I "http://127.0.0.1:${BACKEND_PORT:-3000}/12345678-1.jpg"
```

更多 `/random` 参数说明：见 `docs/api/random.md`。

更完整的发布/迁移/复验顺序（推荐按此执行）：`docs/deployment/redeploy-verify-runbook.md`。

### 1.9 反代（Nginx 示例）

建议把 backend 只监听本机（例如 `BACKEND_PORT=3000`），对外只暴露 Nginx 80/443。

示例（HTTP → backend；请自行加 TLS/证书）：

```nginx
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
  }
}
```

反代后务必在 `.env` 设置：

```bash
TRUST_PROXY=1
```

并建议：
- 后台访问放到内网/堡垒机；或至少 `ADMIN_IP_ALLOWLIST` 只放行你的固定出口 IP。
- 如启用 `ADMIN_CSRF_ENABLED=1` 且外部是 HTTPS、内部是 HTTP，可设置 `ADMIN_CSRF_ALLOWED_ORIGINS=https://example.com`。

### 1.10 升级流程（Docker Compose）

```bash
git checkout test
git pull

docker compose up -d --build
```

## 2) 方案 B：裸机部署（不使用 Docker）

适用：你希望直接在 Ubuntu 上跑 Node/Postgres/Memcached，并用 systemd 管理进程。

### 2.1 安装依赖

- Node.js `>=24`
- PostgreSQL（推荐 16/17）
- Memcached

### 2.2 配置环境变量

参考 `.env.example`，至少需要：
- `REFRESH_TOKENS`
- `MEMCACHED_HOST/MEMCACHED_PORT/MEMCACHED_NAMESPACE`
- `DATABASE_URL`（使用 /random、后台、队列等 DB 功能时必填）
- （反代场景）`TRUST_PROXY=1`
- （后台）`ADMIN_TOKEN`（建议再加 `ADMIN_IP_ALLOWLIST`）

### 2.3 安装依赖 / 构建 / 迁移 / 启动

```bash
npm ci
npm run build
npm run prisma:migrate:deploy
npm run start:prod
```

## 3) 故障排查（快速定位）

1) 启动即退出并提示 env 错误：
- 查看日志输出的 `Invalid environment variables:`，补齐缺失变量（尤其 `REFRESH_TOKENS`）。

2) `/random` 总是 404 `NO_MATCH`：
- 先确认是否已导入图片库（后台导入）；其次检查筛选条件是否过严（`r18/orientation/min_*` 等）。

3) 后台 `/admin` 401：
- 确认已设置 `ADMIN_TOKEN`；浏览器第一次可用 `/admin?token=...` 写入 cookie。

4) 后台 IP allowlist 失效/误判：
- 反代场景务必设置 `TRUST_PROXY=1`。

5) Docker 部署迁移失败：
- 先确认 Postgres 容器已 ready（`pg_isready`），再跑 `docker compose run --rm migrate`（通常无需单独跑，`up` 会自动跑）。
