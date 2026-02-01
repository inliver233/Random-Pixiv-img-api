# Queue (pg-boss)

本项目使用 `pg-boss` 作为基于 PostgreSQL 的任务队列（无需 Redis）。

## 依赖
- `DATABASE_URL` 必须指向可用的 PostgreSQL（pg-boss 会在 schema `pgboss` 下创建所需表）。

## 代码入口
- `src/queue/queue.ts`：队列单例、enqueue/work、health check
- `src/queue/demo.ts`：demo job（用于手动验收）

## /healthz
`GET /healthz` 返回 `queue` 字段：
- `disabled`：未设置 `DATABASE_URL`
- `not_initialized`：未调用 `startQueue/enqueue/work`（进程内尚未启动 boss）
- `null`：已启动且 `getQueues()` 检查通过
- `start_failed:<reason>`：启动失败（可重试；下次调用 `startQueue` 会再次尝试）

## 手动验收：enqueue demo job
1) 确保 PostgreSQL 可用，并设置 `DATABASE_URL`
2) 构建：
   - `npm run build`
3) 运行 demo：
   - `node dist/src/queue/demo.js`

预期：
- 控制台日志出现 `demo job enqueued` 与 `demo job received`

