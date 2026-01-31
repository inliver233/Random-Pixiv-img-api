# Docker Compose（Prod Overlay）

本仓库默认的 `docker-compose.yml` 以 **dev/本地调试** 为主（默认仅暴露 backend 端口；Postgres/Memcached 仅容器网络可达）。

生产/预发布建议叠加 `docker-compose.prod.yml`：
- 不对公网暴露 Postgres/Memcached（仅容器网络可达）。
- backend 增加更贴近生产的运行参数（如 `NODE_ENV=production`）。

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

在提交/部署前，可用以下命令校验合并后的配置是否可生成：

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config
```

注意：
- `.env` / `.env.docker` 属于本机/部署平台配置，不要提交到 git。
- `REFRESH_TOKENS` / `ADMIN_TOKEN` 属于敏感信息，必须用部署平台 secret 注入（或手工维护在服务器上）。
- 如需进一步缩小暴露面（例如只暴露反代端口），请在此 overlay 基础上继续收紧。
