---
mode: plan
task: Final Deep Optimization Against Initial Plan
created_at: "2026-02-06T21:44:59+08:00"
complexity: complex
---

# Plan: Final Deep Optimization Against Initial Plan

## Goal
- 对照 `最初计划.txt` 与 `随机api开发规划.md` 做最后一轮深化优化。
- 在“功能已基本达成”的基础上，消除剩余的工程质量风险：运行时模块加载一致性、回归门禁严谨性、lint 信号纯净度。
- 保持现有功能与契约不回归，完成可追溯闭环（issue -> test -> commit -> push）。

## Scope
- In:
  - 修复 source runtime 下 CJS wrapper / dist 依赖导致的潜在行为漂移。
  - 强化 Admin UI smoke：支持严格模式，避免无 token 时误判通过。
  - 规范 eslint 忽略范围，去除 review 辅助脚本噪声。
  - 更新文档：明确最终质量门禁与执行命令。
  - 全量回归与 CSV 收口。
- Out:
  - 不引入新框架/数据库迁移。
  - 不改动既有 API 契约字段语义。

## Audit Inputs
- `docs/review/2026-02-06_21-44-59-initial-plan-gap-audit.md`
- `E:\pixiv-download-修改版本\最初计划.txt`
- `随机api开发规划.md`

## Execution Rules
- 每个 issue 独立 commit，且包含代码/文档 + 当前 CSV 更新。
- 每个 commit 后立刻 push。
- 不声称测试通过，除非对应命令真实执行。

## Verification Matrix
- Runtime consistency:
  - `npx vitest run test/runtimeModuleResolution.test.ts test/healthz.test.ts test/randomContract.test.ts`
- Admin smoke strictness:
  - `pwsh -NoProfile -File test/admin-ui-smoke.ps1 -BaseUrl http://127.0.0.1:3015`
  - `pwsh -NoProfile -Command "& { $env:ADMIN_TOKEN=''; pwsh -NoProfile -File test/admin-ui-smoke.ps1 -BaseUrl http://127.0.0.1:3015 -RequireAuthChecks; exit $LASTEXITCODE }"`
- Lint quality:
  - `npm run lint`
- Full regression:
  - `npm run test:all`
  - `pwsh -NoProfile -File test/proxy-smoke.ps1 -BaseUrl http://127.0.0.1:3015`
  - `pwsh -NoProfile -File test/admin-ui-smoke.ps1 -BaseUrl http://127.0.0.1:3015`
  - `docker compose up -d` (if blocked, record `blocked:<reason>` + fallback `docker compose config --services`)

## Issue CSV
- `issues/2026-02-06_21-44-59-final-deep-optimization.csv`

## Risks / Blockers
- 当前 shell 可能无 Docker daemon；compose 启动验收可能受限。
- 当前 shell 若无 `ADMIN_TOKEN`，authenticated admin smoke 需以 strict 模式识别为阻断。

## Checkpoints
- Checkpoint after each issue commit + push.
