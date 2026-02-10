# Plan: 修复线上导入/后台 Job 阻断（pg-boss worker 语义）并恢复闭环

## Goal
- 修复线上 `admin_images_import` 等后台 job 全部进入 DLQ（`Invalid import_id`）导致 Image=0、`/random` 永远 `NO_MATCH` 的阻断问题
- 补齐回归测试，防止同类 worker 语义回归
- 将本轮线上审计证据与修复执行绑定到 Issue CSV（单 issue 单 commit）

## Scope
- In:
  - 修复 `src/jobs/importImages.ts` / `src/jobs/adminActions.ts` 的 pg-boss worker handler 入参语义（jobs 数组）
  - 增加单测覆盖（模拟 pg-boss “array callback” 语义，避免再次把 jobs 当单 job）
  - 视需要优化 ImportUrls 页面文案与进度展示（避免“success=0”误导）
  - 落盘并提交本轮线上审计证据（不含任何完整凭据）
- Out:
  - 不在本轮新增新的 Pixiv 上游能力（以恢复闭环与可追溯为主）

## Assumptions / Dependencies
- 需要 redeploy 才能线上复验（本地修复≠线上生效）
- Pixiv 上游与代理池波动属于外部依赖，若阻塞则记录为 `blocked:*`

## Phases
1. 生成本轮 issues CSV + plan（与审计证据绑定）
2. 修复 pg-boss workers（Import + AdminActions）并补测试
3. 本地回归（vitest + admin UI smoke）
4. 提交到 `test` 分支并 push
5. redeploy 后 Chrome MCP 复验并回写证据（单独 issue）

## Tests & Verification
- Worker 语义回归：`npm test`（新增/更新：worker callback array 语义测试）
- 管理后台（本地）：`npm run smoke:admin-ui`（如环境允许）
- 线上复验（redeploy 后）：Chrome DevTools MCP
  - `/admin/pages/importUrls` 导入 10 行样本
  - `/admin/pages/adminJobs` 确认不再出现 `Invalid import_id` DLQ；或可成功重试 DLQ
  - `/admin` Image>0
  - `/random?format=json` 返回非 `NO_MATCH`

## Issue CSV
- Path: `issues/2026-02-10_19-04-21-prod-job-worker-unblock.csv`
- Must share the same timestamp/slug as this plan.

## Tools / MCP
- `functions.shell_command`: 运行单测、lint、git 操作
- `functions.apply_patch`: 落盘 plan/issues/修复代码
- `functions.mcp__chrome-devtools__*`: 线上 Admin 深层动作复验与证据采集

## Acceptance Checklist
- [ ] Import job 不再因 `Invalid import_id` 进入 DLQ
- [ ] AdminActions job（PixivToken.testRefresh / ProxyEndpoint.probe）不再因 job.data 为空失败
- [ ] 新增测试能在 CI 里稳定复现/防回归
- [ ] 修复按 issue 单 commit 落到 `test` 并 push
- [ ] redeploy 后补齐线上证据回写（不含凭据）

## Risks / Blockers
- `blocked:prod_redeploy_required`：无 redeploy 无法关闭线上问题
- `blocked:pixiv_upstream_or_proxy_required`：补全/探测依赖真实 refreshToken/代理池

## Rollback / Recovery
- worker 修复为纯语义调整（handler 入参），回滚只需回退对应 commits
- DLQ jobs：修复上线后可在 `/admin/pages/adminJobs` 选择 DLQ 队列做 retry 抽样验证

## Checkpoints
- Commit after: `META-1900`（plan+issues+证据落盘）
- Commit after: `BUG-1901` / `BUG-1902`（每个 issue 单独 commit）

## References
- 线上审计（Admin）：`docs/review/2026-02-10_18-39-57-admin-deep-audit.md`
- 线上审计（API）：`docs/review/2026-02-10_18-39-57-api-contract-audit.md`

