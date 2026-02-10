# Plan: 解除 Hydration 元数据补全阻断，恢复分类/筛选与随机 API 完整能力

## Goal
- 修复线上 `hydrate_metadata` / `hydration_backfill` 因 `Invalid illust_id` / `Invalid run_id` 导致 DLQ 阻断的问题
- 让元数据覆盖率开始回升（geometry/author/x_restrict/tags）
- 使 `/tags` `/authors` 由空变为可用；`/random` 的筛选矩阵（r18/orientation/min_*/*tags/user_id 等）由大量 `NO_MATCH` 回归为可命中
- 补齐回归测试（避免再次出现“字符串数字被判 invalid”）

## Scope
- In:
  - 修复 `illust_id/run_id` 的数字字符串解析（worker 内部校验）并覆盖到 `hydrate_metadata` 与 `hydration_backfill`
  - 增加回归测试：数字字符串可被解析；避免错误正则 `^\\d+$` 回归
  - redeploy 后通过 Admin 页面 **重试 DLQ** 并验证元数据开始写入（证据落盘）
  - 追溯性门槛：补齐 `/version.commit`（沿用上一轮未完成项）
- Out（本轮不强行推进，但若复验中发现阻断会追加 issue）:
  - Pixiv 上游策略大改（仅修复阻断与保证现有能力可用）

## Evidence baseline（本轮已落盘）
- Admin 深测：`docs/review/2026-02-10_23-45-39-admin-deep-audit.md`
- API 契约：`docs/review/2026-02-10_23-45-39-api-contract-audit.md`
- 截图：`docs/review/screenshots/2026-02-10_23-45-39/*`
- 网络：`docs/review/network/2026-02-10_23-45-39/*`

## Phases
1. 生成 issues CSV（本文件同时间戳）并将证据与修复绑定
2. 修复 `illust_id/run_id` 解析阻断 + 回归测试
3. 本地回归（vitest）→ push `test`
4. redeploy 后 Chrome MCP 复验（DLQ retry + 覆盖率回升 + /tags /authors /random 筛选）

## Tests & Verification
- 单测：`npm test`
- 线上复验（redeploy 后，Chrome MCP）：
  - `/admin/pages/adminJobs`：对 `hydrate_metadata__dlq` / `hydration_backfill__dlq` 抽样点击“重试”
  - `/admin/pages/hydrationOps`：确认 DLQ count 下降、missing.* 开始下降、tags_total/image_tags_total > 0
  - API：`/tags`、`/authors` 返回非空；`/random?format=json` 返回 metadata 非空；筛选参数命中率提升

## Issue CSV
- Path：`issues/2026-02-10_23-45-39-hydration-metadata-recovery.csv`

## Tools / MCP
- `functions.shell_command`：单测、git、脚本
- `functions.apply_patch`：修复与落盘
- `functions.mcp__chrome-devtools__*`：线上 Admin 深层动作与证据采集

## Risks / Blockers
- `blocked:prod_redeploy_required`：若平台未 redeploy，则无法在 `https://i.mukyu.ru` 关闭线上问题
- `blocked:pixiv_upstream_or_proxy_required`：Pixiv 上游/代理池波动可能导致补全吞吐下降，但不应再出现“解析阻断导致全量 DLQ”

