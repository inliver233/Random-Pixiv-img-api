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

## origin_url masking

- 任何输出到**日志/错误响应**的 URL（尤其是 `origin_url`）默认会移除 query/hash（例如 `?token=...`），避免泄漏敏感信息。
- 对于上游请求类错误（例如 Axios error），日志会尽量输出 `origin_url` 的 **scheme/host/path** 部分，便于定位资源但不暴露 query。

## Error codes

> 约定：所有 JSON 错误响应返回 `{ code, message, request_id }`。HTML（legacy）错误页仅展示 `request_id`（不保证包含 code）。

| code | http | meaning | notes |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | 请求参数非法/缺失 | 未显式设置 `err.code` 时的默认值 |
| `UNAUTHORIZED` | 401 | 未授权 | 同上 |
| `FORBIDDEN` | 403 | 禁止访问 | 同上 |
| `NOT_FOUND` | 404 | 资源不存在 | 同上 |
| `RATE_LIMIT` | 429 | 本服务限流 | 同上 |
| `INTERNAL_SERVER_ERROR` | 500 | 服务内部错误 | 同上（message 会被固定为 `Internal Server Error`） |
| `NO_MATCH` | 404 | 随机筛选无匹配图片 | `/random` 在筛选无结果时返回 |
| `UNSUPPORTED_URL` | 400 | 不支持的 URL（host/path 形态不匹配） | URL 解析类失败（例如 Pixiv 原图 URL） |
| `UPSTREAM_RATE_LIMIT` | 503 | 上游限流 | Pixiv API 或图片上游返回限流/触发熔断时使用 |
