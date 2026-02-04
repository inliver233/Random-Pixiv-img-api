# DB 迁移与回滚 Runbook（Prisma + PostgreSQL）

本文用于生产部署时的 DB 迁移执行、备份与回滚，避免升级过程引发数据事故。

> 适用：pixivcat-backend（Prisma + PostgreSQL）。  
> 重要：生产环境不要使用 `prisma migrate dev`，应使用 `prisma migrate deploy`（或 compose 内置 `migrate` one-off 服务）。

## 1. 术语与原则

- **迁移（migration）**：`prisma/migrations/*/migration.sql`，用于把 DB schema 升级到与 `prisma/schema.prisma` 一致。
- **回滚**：Prisma SQL 迁移默认不提供自动 down migration。生产回滚通常是：
  - **回滚代码到旧版本** + **从备份恢复 DB**（推荐、最可控）
  - 或在少数情况下手工写 SQL 逆向变更（高风险，不推荐）
- **最重要的原则**：先备份、再迁移；迁移失败优先恢复备份，而不是“现场硬改”。

## 2. 升级前必做检查

1) 确认当前版本与目标版本
```bash
git rev-parse --short HEAD
git log --oneline -n 10
```

2) 确认迁移文件存在且已纳入版本控制
```bash
ls prisma/migrations
```

3) 备份策略已就绪（至少 pg_dump）

## 3. 备份（pg_dump）

> 强烈建议：每次升级前做一次全量备份，并把备份文件放到“独立于容器/卷”的持久化位置。

### 3.1 Docker Compose 环境备份（推荐）
```bash
docker compose exec -T postgres \\
  pg_dump -U \"${POSTGRES_USER:-pixivcat}\" \"${POSTGRES_DB:-pixivcat}\" > backup.sql
gzip -9 backup.sql
ls -lh backup.sql.gz
```

### 3.2 恢复（会覆盖现有数据，慎用）
```bash
gunzip -c backup.sql.gz | docker compose exec -T postgres \\
  psql -U \"${POSTGRES_USER:-pixivcat}\" \"${POSTGRES_DB:-pixivcat}\"
```

## 4. 执行迁移（生产）

### 4.1 使用 compose 内置 `migrate` one-off（推荐）
仓库的 `docker-compose.yml` 提供 `migrate` 服务（one-off），用于执行：
- `prisma migrate deploy`
- `prisma generate`

执行方式（示例）：
```bash
docker compose run --rm migrate
```

然后再拉起/重启 backend：
```bash
docker compose up -d backend
```

### 4.2 不使用 compose 的迁移（裸机/CI）
```bash
npm ci
npm run prisma:migrate:deploy
npm run prisma:generate
```

## 5. 验证（迁移后）

1) 检查服务健康
```bash
curl -fsS http://127.0.0.1:3000/healthz
```

2) 检查 Prisma 迁移状态（可选）
```bash
npx prisma migrate status
```

3) 跑最小回归（建议）
```bash
npm test
```

## 6. 回滚方案（推荐流程）

当升级后出现严重问题（启动失败、数据异常、性能显著退化）：

1) 停止 backend（保留 DB）
```bash
docker compose stop backend
```

2) 回滚代码到上一个稳定版本（旧 commit / tag）
```bash
git checkout <old-commit-or-tag>
```

3) 从升级前备份恢复 DB
```bash
gunzip -c backup.sql.gz | docker compose exec -T postgres \\
  psql -U \"${POSTGRES_USER:-pixivcat}\" \"${POSTGRES_DB:-pixivcat}\"
```

4) 重新启动旧版本服务
```bash
docker compose up -d --build backend
```

5) 复核健康与核心接口（/admin、/random、legacy 路由等）

## 7. 常见坑（务必注意）

- `prisma migrate dev` 会创建 shadow database；生产环境通常权限不允许且不应使用。
- 回滚不要依赖“手工删列/改表”来试图回到旧版本；除非你非常确定影响范围并有完整备份。
- 迁移失败时，优先 `docker compose logs migrate` / `backend` 定位原因；必要时先恢复备份再排查。

