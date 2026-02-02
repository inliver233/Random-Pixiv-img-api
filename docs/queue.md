# Queue (pg-boss)

本项目使用 `pg-boss` 作为基于 PostgreSQL 的任务队列（无需 Redis）。

## 依赖
- `DATABASE_URL` 必须指向可用的 PostgreSQL（pg-boss 会在 schema `pgboss` 下创建所需表）。

## 代码入口
- `src/queue/queue.ts`：队列单例、enqueue/work、health check
- `src/queue/demo.ts`：demo job（用于手动验收）

## heal_url：URL 自愈任务
当图片代理遇到“疑似原图 URL 失效”时，会 enqueue `heal_url`（按 `illust_id` 粒度）去冷路径调用 Pixiv detail，刷新 DB 中该作品各页的 `original_url/ext`，并将非 disabled 的图片恢复为 `active`。

### 触发策略（默认安全，可配置）
- 默认仅在代理上游返回 `403/404` 时触发（见 `HEAL_TRIGGER_STATUSES`）。
- 为避免把“上游限流”误判为“URL 失效”，当上游响应带 `Retry-After` 时（常见于 rate limit），默认 **不触发** 自愈（见 `HEAL_TRIGGER_SKIP_IF_RETRY_AFTER`）。
- 对网络错误/超时等无 `response.status` 的错误，不触发自愈（避免放大抖动）。

可用环境变量（同时维护于 `src/config/env.ts` 与 `src/config/env.js`）：
- `HEAL_TRIGGER_STATUSES`：触发自愈的上游 HTTP 状态码列表（逗号分隔），默认：`403,404`（设置为空可禁用触发）。
- `HEAL_TRIGGER_SKIP_IF_RETRY_AFTER`：当上游错误响应包含 `Retry-After` 时跳过自愈，默认：`true`。

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
