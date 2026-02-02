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
- `HEAL_DEBOUNCE_SECONDS`：同一 `illust_id` 的自愈触发去抖窗口（秒），默认：`600`（10 分钟）。设置为 `0` 可禁用去抖；启用时重复触发会被 pg-boss throttle 掉（返回 `null` job id）。
- `HEAL_RETRY_LIMIT`：失败重试次数上限（pg-boss `retryLimit`），默认：`5`。
- `HEAL_RETRY_DELAY_SECONDS`：重试初始延迟（秒，pg-boss `retryDelay`），默认：`60`。
- `HEAL_RETRY_DELAY_MAX_SECONDS`：重试延迟最大值（秒，pg-boss `retryDelayMax`），默认：`3600`。
- `HEAL_RETRY_BACKOFF`：是否启用指数退避（pg-boss `retryBackoff`），默认：`true`。

## hydrate_metadata：元信息补全任务
`hydrate_metadata`/`heal_url` 会走冷路径调用 Pixiv detail。为避免触发 Pixiv 限流，内置了“按 token + 全局”的并发与速率限制（仅影响 job 冷路径，不影响 legacy 兼容路由的直接请求路径）。

可用环境变量（同时维护于 `src/config/env.ts` 与 `src/config/env.js`）：
- `HYDRATE_MAX_IN_FLIGHT`：全局最大并发（0 表示不限制），默认：`1`。
- `HYDRATE_MAX_IN_FLIGHT_PER_TOKEN`：每个 token 的最大并发（0 表示不限制），默认：`1`。
- `HYDRATE_RATE_LIMIT_GLOBAL_MS`：全局最小间隔（毫秒，0 表示不限制），默认：`200`。
- `HYDRATE_RATE_LIMIT_PER_TOKEN_MS`：每个 token 的最小间隔（毫秒，0 表示不限制），默认：`1000`。

## dead-letter：失败作业归档（DLQ）
当 job 执行失败且超过 `retryLimit` 阈值后，pg-boss 可将该 job 路由到 dead-letter queue（DLQ）以便排障与人工处理。

本项目默认启用“每个队列一个 DLQ”：
- DLQ 名称：`<queue_name><QUEUE_DEAD_LETTER_SUFFIX>`
- 默认 suffix：`__dlq`
- 例：`heal_url__dlq`、`hydrate_metadata__dlq`

默认不注册 DLQ worker（避免自动消费/删除），因此 job 会保留在 DLQ 中供排查。

可用环境变量（同时维护于 `src/config/env.ts` 与 `src/config/env.js`）：
- `QUEUE_DEAD_LETTER_ENABLED`：是否启用 DLQ，默认：`true`。
- `QUEUE_DEAD_LETTER_SUFFIX`：DLQ 后缀，默认：`__dlq`。

手动查看建议：
- 用 pg-boss API：`boss.getQueueStats('<dlq_name>')`
- 或直接查询 DB（schema `pgboss`）

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
