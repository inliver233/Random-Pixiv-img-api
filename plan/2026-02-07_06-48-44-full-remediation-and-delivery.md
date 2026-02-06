---
mode: plan
task: Full Remediation and Delivery Loop from 2026-02-07 audits
created_at: "2026-02-07T06:48:44+08:00"
complexity: complex
---

# Plan: Full Remediation and Delivery

## Goal
- 基于 2026-02-07 审计证据完成“调查 -> issues 拆解 -> 实现 -> 测试 -> 提交 -> 回归 -> 复盘”闭环。
- 覆盖 `页面和功能实现问题.md` Top10 与其余问题，不遗漏 High/Medium/Low。
- 输出可追溯交付链：issue CSV、逐条测试证据、commit、执行日志、最终审计报告。

## Scope
- In:
  - Admin 高风险缺陷：TokenProxyBinding 读路径 500、ProxyPoolOverview 卡死、ProxyEndpoint probe 504、深链 action 缺组件。
  - 中低风险缺陷：new/edit 路由一致性、HydrationRun 空态恢复、legacy 错误包一致性、强筛选 NO_MATCH 降级体验、favicon 400、HydrationOps 可访问性。
  - 测试与回归：每个 issue 最小测试 + 全量回归（lint/test/smoke）+ API/Admin 抽样复验。
  - 交付文档：执行日志与 post-remediation 复盘。
- Out:
  - 不做 destructive git 操作。
  - 不把敏感凭据明文写入仓库。
  - 不阻塞在外部依赖，无法消除时按 `blocked:<reason>` 记录并继续。

## Audit Inputs
- `E:/pixiv-download-修改版本/页面和功能实现问题.md`
- `docs/review/2026-02-07_03-30-03-admin-deep-audit.md`
- `docs/review/2026-02-07_03-30-03-api-contract-audit.md`
- `docs/review/2026-02-07_03-30-03-admin-rerun-network-evidence.json`
- `docs/review/2026-02-07_03-30-03-api-test-results.json`
- `issues/README.md`
- `README.md`, `docs/**`, `plan/**`, `issues/**`

## Execution Rules
- 严格按 CSV 顺序执行 issue，不跳条；每条必须真实测试并记录命令与关键输出。
- 每条 issue 至少一个 commit，commit message 必须包含 issue ID。
- CSV 字段保持完整，状态流转：`TODO -> DOING -> DONE`，Review/Regression 仅在真实验证后置 DONE。
- 外部依赖阻塞时标记 `blocked:<reason>`，继续后续 issue。

## Phases
1. 建立全新计划与 issue 清单（本文件 + `issues/2026-02-07_06-48-44-full-remediation-and-delivery.csv`）。
2. 逐条实现与最小测试闭环（代码、测试、CSV 回填、commit）。
3. 全量回归 + API/Admin 抽样复验 + 执行日志。
4. 输出 post-remediation 审计总结与剩余风险。

## Tests & Verification
- Per-issue: 以 CSV `Test_Method` 为准（vitest/curl/pwsh/manual checklist）。
- Full regression:
  - `npm run lint`
  - `npm run test:all`
  - `npm run test:admin-runtime`
  - `pwsh -NoProfile -File test/proxy-smoke.ps1 -BaseUrl <base>`
  - `pwsh -NoProfile -File test/admin-ui-smoke.ps1 -BaseUrl <base> [-AdminToken <masked>]`
- API sampling:
  - `/random`, `/images`, `/tags`, `/authors`, `/healthz`, `/metrics`
- Admin sampling:
  - `/admin/pages/proxyPoolOverview`, `/admin/pages/hydrationOps`, `/admin/pages/tokenProxyBindings`

## Issue CSV
- Path: `issues/2026-02-07_06-48-44-full-remediation-and-delivery.csv`

## Risks / Blockers
- 云侧网关/外部代理链路可能导致 504，不保证完全消除。
- 本地缺少真实生产数据时，强筛选命中率只能做到降级体验与可观测增强。
- 若缺少 `ADMIN_TOKEN`，Admin 关键动作实测可能降级为受限验证。

## Checkpoints
- 每个 issue 完成后立即：更新 CSV + 记录执行日志 + commit。
- 全部 issue 完成后：统一跑回归并回填 Regression。

## Deliverables
- `plan/2026-02-07_06-48-44-full-remediation-and-delivery.md`
- `issues/2026-02-07_06-48-44-full-remediation-and-delivery.csv`
- `docs/review/<timestamp>-implementation-execution-log.md`
- `docs/review/<timestamp>-post-remediation-audit.md`
