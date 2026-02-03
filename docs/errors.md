# Errors & Observability

本项目面向“图片代理 + 随机图片 API”的场景，默认以 **结构化日志（pino）** 作为排障主入口；错误响应/日志会携带 `request_id`，便于跨请求与异步任务（job）串联。

## request_id

- 每个 HTTP 请求都会分配 `request_id`（优先使用请求头 `X-Request-Id`，否则生成 UUID），并在响应头回显 `X-Request-Id`。
- 关键请求日志包含 `request_id` 字段（例如 `message=request`）。
- 当后台任务（pg-boss job）由某个 HTTP 请求触发时，会把 `request_id` 写入 job payload，并在 worker 日志中输出同一个 `request_id`（例如 `message=heal_url done` / `message=hydrate_metadata done`）。
- 注意：`request_id` 仅用于日志/排障，不会作为 Prometheus label（避免高基数）。

## Manual verification

1. 启动服务（需要可用的 PostgreSQL 以启用队列 worker）。
2. 发起一个会触发 job 的请求（例如请求一个已 broken 的 `/i/:id.:ext` 以触发 `heal_url`，或通过 `/admin/images/import` 导入触发 `hydrate_metadata`）。
3. 检查 stdout 日志：应能看到同一个 `request_id` 同时出现在 request 日志与对应 job 的 done/failed 日志中。

