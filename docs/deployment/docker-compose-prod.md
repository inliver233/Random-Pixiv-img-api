# Docker Compose（单文件生产推荐）

从 `RAPI-0226` 起，本仓库的 `docker-compose.yml` 已包含生产推荐配置，并内置 `migrate` 一次性任务（Prisma migrate deploy）。

推荐一条命令完成：
- 启动 Postgres + Memcached
- 执行 DB 迁移（`migrate`）
- 启动 backend

```bash
docker compose up -d --build
```

说明：
- `migrate` 会在迁移完成后正常退出（`Exited (0)`），属于预期行为。
- 重复执行 `docker compose up -d --build` 是安全的（适合升级/重启）。

## 可选生产加固（全部在 `docker-compose.yml` 里）

（可选）进一步收紧 backend 的运行时写权限（只读文件系统）：

```bash
BACKEND_READ_ONLY=true docker compose up -d --build
```

（可选）设置 backend 的 CPU/内存限制与 `nofile` ulimit（按机器资源调整）：

```bash
BACKEND_LIMIT_CPUS=1.0 BACKEND_LIMIT_MEMORY=1024M BACKEND_ULIMIT_NOFILE_SOFT=65535 BACKEND_ULIMIT_NOFILE_HARD=65535 docker compose up -d --build
```

（可选）配置 backend 容器日志轮转（Docker json-file driver 的宿主轮转）：

```bash
BACKEND_LOG_MAX_SIZE=10m BACKEND_LOG_MAX_FILE=3 docker compose up -d --build
```

在提交/部署前，可用以下命令校验 compose 配置是否可生成：

```bash
docker compose -f docker-compose.yml config
```

## 备注：docker-compose.prod.yml

仓库仍保留 `docker-compose.prod.yml` 作为历史 overlay（便于旧部署脚本兼容）。
在新版本中它已非必需；除非你明确知道要覆盖什么，否则建议只使用 `docker-compose.yml`。

注意：
- `.env` 属于部署平台配置，不要提交到 git。
- `REFRESH_TOKENS` / `ADMIN_TOKEN` 属于敏感信息，必须用部署平台 secret 注入（或只保存在服务器上）。
- 生产镜像构建建议使用 `.dockerignore`（本仓库已提供）来避免把 `.env*` 等敏感文件打包进 build context。
- 启用只读文件系统时，compose 通过 `tmpfs` 提供 `/tmp` 与 `/app/.adminjs`（AdminJS bundler 输出）等必要写路径。
- backend 日志默认输出到 stdout；生产环境建议由宿主侧（Docker logging driver / 日志采集）负责轮转与归档。
