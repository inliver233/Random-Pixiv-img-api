# Production Security Checklist（部署安全清单）

> 目的：把“生产部署必须确认的安全项”落盘为可执行 checklist，避免误配导致明文密钥泄露或端口暴露。

## 0) 基本前提

- [ ] 生产环境设置 `NODE_ENV=production`
- [ ] 生产环境不要用示例 token（`REFRESH_TOKENS=["please_set_refresh_token"]` 仅用于占位）

## 1) Secrets 管理

- [ ] `REFRESH_TOKENS` 不进 git（使用部署平台 secret 注入或服务器本地 `.env`）
- [ ] （可选）后台鉴权 `ADMIN_TOKEN` 不进 git
- [ ] 数据库口令（`POSTGRES_PASSWORD` 等）不进 git
- [ ] `.dockerignore` 已忽略 `.env*` 等敏感文件，避免被打包进 build context
- [ ] Docker 镜像构建过程不复制 `.env`/secrets（仅通过运行时环境变量注入）
- [ ] 日志/响应不得输出明文 token

## 2) 端口暴露 / 网络隔离

- [ ] 只暴露 backend 对外端口（默认 `3000`）
- [ ] Postgres/Memcached 不对公网暴露（仅容器网络可达）
- [ ] 使用 `docker-compose.prod.yml` 叠加来移除 `postgres/memcached` 的 `ports`

## 3) 运行时与镜像（Docker）

- [ ] 容器尽可能以非 root 用户运行（本仓库 Dockerfile 使用 `USER node`）
- [ ] 生产镜像仅包含 `dist/` 与生产依赖（多阶段构建）

## 4) 自查（一次执行就够）

1. [ ] 运行 `docker compose -f docker-compose.yml -f docker-compose.prod.yml config`，确认 `postgres/memcached` 没有 `ports`
2. [ ] 启动后确认仅 backend 端口对外可达（数据库/缓存端口不可直连）

## 5) 相关文件（本仓库）

- Compose（dev）：`../../docker-compose.yml`
- Prod overlay：`../../docker-compose.prod.yml`
- Dockerfile：`../../Dockerfile`
- 部署说明：`docker-compose-prod.md`
