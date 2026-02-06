# Production Security Checklist（部署安全清单）

> 目的：把“生产部署必须确认的安全项”落盘为可执行 checklist，避免误配导致明文密钥泄露或端口暴露。

## 0) 基本前提

- [ ] 生产环境设置 `NODE_ENV=production`
- [ ] 生产环境不要用示例 token（`REFRESH_TOKENS=["please_set_refresh_token"]` 仅用于占位）

## 1) Secrets 管理

- [ ] `REFRESH_TOKENS` 不进 git（使用部署平台 secret 注入或服务器本地 `.env`）
- [ ] （可选）后台鉴权 `ADMIN_TOKEN` 不进 git
- [ ] （可选）easy_proxies 密码（如启用）不进 git（同样用 secret 注入）
- [ ] 数据库口令（`POSTGRES_PASSWORD` 等）不进 git
- [ ] `.dockerignore` 已忽略 `.env*` 等敏感文件，避免被打包进 build context
- [ ] Docker 镜像构建过程不复制 `.env`/secrets（仅通过运行时环境变量注入）
- [ ] 日志/响应不得输出明文 token

## 1.5) 管理后台（/admin）与导入能力

> 说明：后台包含 ProxyEndpoint 管理、easy_proxies 导入、URL 导入与相关运行时配置。必须确保这些能力只在 admin 体系内可用。

- [ ] 生产环境必须设置强随机 `ADMIN_TOKEN`（推荐 ≥ 32 字符），不要使用弱口令/默认值
- [ ] `ADMIN_TOKEN` 仅用于 admin：不应在任何公开 API 响应/日志中出现（含 querystring、header、body）
- [ ] URI 导入链路（`/admin/pages/easyProxiesImport`）中不得记录明文 proxy 密码；审计只保留脱敏摘要
- [ ] `refresh_token`、proxy 密码、Authorization 头在日志中必须 redaction（`[REDACTED]`）
- [ ] 导入反馈应只输出行号与错误原因，不回显明文口令（例如 `line=xx + error`，不打印完整 secret）
- [ ] （推荐）设置 `ADMIN_IP_ALLOWLIST` 将 `/admin` 访问限制在内网/VPN/IP 段内（见 `../admin.md`）
- [ ] （推荐）如通过反代/HTTPS 终止部署：配置 `TRUST_PROXY`，确保 `req.secure` 与客户端 IP 获取正确（cookie Secure、IP allowlist 依赖）
- [ ] （可选）启用账号+session 登录：`ADMIN_SESSION_AUTH_ENABLED=true` 并配置 `ADMIN_SESSION_*`（见 `../admin.md`）
- [ ] （可选）启用 CSRF：`ADMIN_CSRF_ENABLED=true`（cookie/session 模式建议开启；反代场景可配 `ADMIN_CSRF_ALLOWED_ORIGINS`）
- [ ] （可选）启用后台写操作限流：`ADMIN_RATE_LIMIT_ENABLED=true`（防爆破/误操作）
- [ ] 确认导入与代理管理仅在 `/admin` 下可触达：不带 `ADMIN_TOKEN`（且未登录 session）访问应返回 `401/403`
- [ ] 对危险操作（关闭代理、回滚 easy_proxies、删除 DLQ 作业）启用二次确认并记录审计动作

## 2) 端口暴露 / 网络隔离

- [ ] 只暴露 backend 对外端口（默认 `3000`）
- [ ] Postgres/Memcached 不对公网暴露（仅容器网络可达）
  - 本仓库 `docker-compose.yml` 默认不暴露 `postgres/memcached` 的 `ports`

## 3) 运行时与镜像（Docker）

- [ ] 容器尽可能以非 root 用户运行（本仓库 Dockerfile 使用 `USER node`）
- [ ] 生产镜像仅包含 `dist/` 与生产依赖（多阶段构建）
- [ ] Docker HEALTHCHECK 已启用并调用 `/healthz`（用于容器编排的健康探测）
- [ ] （可选）启用 backend 只读文件系统（`BACKEND_READ_ONLY=true`）；并确认 `tmpfs` 已挂载 `/tmp` 与 `/app/.adminjs`
- [ ] （可选）设置 backend 的 CPU/内存限制与 `nofile` ulimit（`docker-compose.yml`：`BACKEND_LIMIT_*` / `BACKEND_ULIMIT_*`）
- [ ] （可选）配置容器日志轮转（stdout + 宿主轮转）：`docker-compose.yml` 的 `logging`（`BACKEND_LOG_MAX_*`）

## 4) 自查（一次执行就够）

1. [ ] 运行 `docker compose -f docker-compose.yml config`，确认 `postgres/memcached` 没有 `ports`
2. [ ] 启动后确认仅 backend 端口对外可达（数据库/缓存端口不可直连）
3. [ ] （可选）启用 `BACKEND_READ_ONLY=true` 后启动，确认 `/healthz` 正常并可访问 `/admin`
4. [ ] （可选）启用自定义 `BACKEND_LIMIT_*` 后启动，确认容器启动成功（必要时用 `docker inspect` 查看限制是否生效）
5. [ ] （可选）确认 backend 的日志轮转策略（`docker inspect` 查看 LogConfig 或宿主侧日志采集/轮转）
6. [ ] 运行 `pwsh test/admin-ui-smoke.ps1 -BaseUrl http://127.0.0.1:3000 -AdminToken <ADMIN_TOKEN>`，确认 Admin 关键页面可访问

## 4.1) compose 受限环境（无 daemon）兜底检查

当当前终端无法访问 Docker daemon（例如 `docker info` 超时）时，至少完成下列“结构可部署性”校验并记录：

1. [ ] 执行 `docker compose -f docker-compose.yml config --services`
2. [ ] 结果必须包含且仅包含：`memcached`、`postgres`、`migrate`、`backend`
3. [ ] 在部署记录中写明 `validation_limited:<原因>`，并补充“待在可用 daemon 环境执行 `docker compose up -d`”的复验计划

> 说明：`config --services` 不依赖 daemon，可用于提前发现 compose 结构错误；但不能替代真实启动验收。

## 5) 相关文件（本仓库）

- Compose（单文件，生产推荐）：`../../docker-compose.yml`
- （可选）历史 overlay（兼容旧脚本）：`../../docker-compose.prod.yml`
- Dockerfile：`../../Dockerfile`
- 部署说明：`docker-compose-prod.md`
