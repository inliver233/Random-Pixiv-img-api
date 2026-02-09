# Redeploy + Verify Runbook（生产发布与复验）

> 目的：把“发布/迁移/复验”的顺序与验收门槛固定下来，避免出现“我以为上线了，但其实还是旧版本”的情况。  
> 安全规则：本文档不得写入任何完整凭据（token/password/refresh_token/proxy 密码）。示例仅用占位符或掩码（`***`）。

## 0) 前置检查（必须做）

1) 确认本次要发布的 commit（建议记录到发布单/工单）

```bash
git rev-parse --short HEAD
git log --oneline -n 5
```

2) 生产 secrets 通过部署平台或服务器本地注入（不要进 git）

- `DATABASE_URL`
- `ADMIN_TOKEN`（或启用 session auth）
- `REFRESH_TOKENS` / Pixiv refreshToken（掩码记录：`Px***`）
- 代理池（如启用，URI 内口令必须脱敏记录：`http://inl***:***@host:port`）

3) 迁移前备份（强烈建议）

见：`db-migrations.md` 的 `pg_dump` 章节。

## 1) 发布顺序（Docker Compose 推荐）

> 本仓库 `docker-compose.yml` 已包含 `migrate` one-off 服务（`prisma migrate deploy`）。

1) 拉取代码/镜像（按你的部署方式）
2) 执行迁移

```bash
docker compose run --rm migrate
```

3) 重启/拉起 backend

```bash
docker compose up -d --build backend
docker compose ps
docker compose logs backend --tail=200
```

## 2) 发布一致性校验（必须做，否则一律视为“未上线”）

### 2.1 /healthz 与 /version（build 可追溯）

```bash
curl -fsS https://<your-domain>/healthz
curl -fsS https://<your-domain>/version
```

预期：
- `ok=true`
- 响应体包含 `build.version / build.commit / build.build_time`

### 2.2 Smoke：commit 对齐（推荐作为发布门禁）

本仓库提供脚本：`scripts/smoke-runtime.mjs`（npm 脚本：`npm run smoke:runtime`）

```bash
# 1) 直接验证线上 build.commit 是否可读且一致（/healthz 与 /version）
npm run smoke:runtime -- https://<your-domain>

# 2) 可选：指定期望 commit（用于 CI/发布单）
EXPECTED_COMMIT=<commit> npm run smoke:runtime -- https://<your-domain>
```

> 若脚本返回 `commit_mismatch_expected` / `version_failed` / `healthz_failed`，说明当前域名仍未指向新部署或缓存未刷新，应先处理该问题再做后续复验。

> 若脚本返回 `commit_missing`，通常表示构建/运行时未注入 commit（例如 Docker build context 不包含 `.git`）。  
> 修复方式：在部署时显式设置 `APP_COMMIT`（推荐）或平台提供的 `SOURCE_VERSION/GIT_COMMIT_SHA` 等变量。
>
> - Bash：`APP_COMMIT=$(git rev-parse HEAD) docker compose up -d --build`
> - PowerShell：`$env:APP_COMMIT=(git rev-parse HEAD); docker compose up -d --build`

## 3) Admin 快速冒烟（推荐）

无需浏览器手工点：使用 `test/admin-ui-smoke.ps1` 覆盖关键页面与 page API。

```powershell
pwsh -NoProfile -File test/admin-ui-smoke.ps1 -BaseUrl https://<your-domain> -AdminToken <ADMIN_TOKEN> -RequireAuthChecks
```

预期：
- `/admin/pages/*` 返回 `200`（或在依赖未 ready 时可短暂 `503`，但不应出现 “未指定组件/no component specified”）
- `/admin/api/pages/*` 返回 JSON 且包含组件元数据

## 4) API 冒烟（推荐）

```powershell
# 会检查 /healthz、/random(json/redirect)、legacy 错误包结构等
pwsh -NoProfile -File test/proxy-smoke.ps1 -BaseUrl https://<your-domain>
```

注意：
- `/metrics` 默认受保护（见 `docs/usage/handbook.md` 的 /metrics 章节）。若你为 /metrics 配置了 Basic Auth，可在 smoke 时传入（见脚本参数）。

## 5) 全量线上复验（强制，redeploy 后必须做）

完成上述 smoke 后，再进行“深层动作”复验并落盘证据：
- Admin：`/admin/pages/*`、`/admin/resources/*`（list/show/new/edit）与 actions 深链与触发
- API：`/random` 参数矩阵、`/images`、`/tags`、`/authors`、legacy 路由

执行合同：
- `issues/2026-02-10_05-39-47-final-perfect-delivery.csv` 的 `E2E-2005`

证据落盘目录（示例）：
- `docs/review/screenshots/<timestamp>/`
- `docs/review/network/<timestamp>/`
- `docs/review/console/<timestamp>/`
