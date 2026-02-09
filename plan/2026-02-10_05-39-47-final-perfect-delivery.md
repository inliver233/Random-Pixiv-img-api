# Plan: Final Perfect Delivery（闭环可用性 + 可维护性 + 回归 + 可发布）

## Goal
- 以“用户可理解且可复用的闭环”为唯一标准，交付：
  1) Admin 批量导入 Pixiv 原图 URL（可追溯 import_id/job_id，可回滚）
  2) refreshToken + 代理池驱动冷路径补全元数据（作者/标签/R18/宽高等）并可观测/可恢复
  3) 分类检索可用（`/tags` `/authors` `/images`）
  4) `/random` 高可用（image/json/redirect；失败换图重试；参数矩阵契约一致）
  5) 管理后台“看得懂、用得上”（空态/异常态可解释并指向下一步）

## Current State（Repo）
- 分支：`test`（本地领先 `origin/test` 多个修复提交）
- 上一轮执行合同：`plan/2026-02-10_04-21-53-second-round-execution.md` + `issues/2026-02-10_04-21-53-second-round-execution.csv`
- 关键现实：线上 `https://i.mukyu.ru` 若未 redeploy，则线上体验仍为旧行为；线上复验必须标记为 `blocked:prod_redeploy_required`，不得伪造通过。

## Scope
- In:
  - 收敛 Admin UX（闭环告警/下一步链接/误导文案）
  - 产出本轮总报告：`第二次最详细页面和功能实现问题.md`（中文、可执行、证据链、代码定位、修复建议）
  - 回写“已修复但未验证”的状态：跑本地回归并更新 issue CSV 的 Review/Regression
  - 补齐发布/复验手册：redeploy + migrate + smoke + Chrome MCP 复验清单
- Out:
  - 更换 AdminJS（如需替换，另起独立 plan/epic）
  - 引入新的外部图像处理链（imgproxy）之外的重依赖（可后续另起 epic）

## Assumptions / Dependencies
- Postgres + pg-boss schema 可用（`DATABASE_URL` 已配置）是 import/hydration/job 的前置条件。
- 线上复验依赖人工 redeploy；未 redeploy 前只做“线上旧行为复现与证据归档”，不做“修复后线上通过”的结论。
- 所有文档/证据/日志不得写入完整凭据（password/token/refresh_token/proxy 密码/cookie/authorization）。

## Execution Rules
- 单 issue 单 commit（commit message 前缀包含 Issue ID）
- 每个 issue 必须包含：Acceptance + Test_Method（可执行）+ Files 范围
- 所有敏感信息统一脱敏（仅允许 `***` / `inl***` / `Px***` 等形式）

## Phases
1. 固化本轮执行合同（本 plan + 本轮 issue CSV）
2. 修复 Admin 闭环告警与“下一步路径”（空态/异常态可恢复）
3. 生成总报告（把审计证据、问题、修复、blocked 全部落盘）
4. 本地回归（lint + vitest + smoke），并回写 Review/Regression 状态
5. 发布准备与线上复验清单（redeploy + migrate 后，用 Chrome MCP 全覆盖复验并更新证据链）

## Tests & Verification
- 全量回归：`npm run test:all`
- Admin 运行态检查：`npm run test:admin-runtime`
- 运行态 smoke（本机/容器）：`npm run smoke:runtime`
- 线上复验（redeploy 后）：Chrome MCP 全覆盖 `/admin/pages/*`、`/admin/resources/*`、actions 深链与触发

## Issue CSV
- Path: `issues/2026-02-10_05-39-47-final-perfect-delivery.csv`
- Must share the same timestamp/slug as this plan.

## References
- 上一轮修复验证清单：`docs/review/fixes/2026-02-09_05-56-38/`
- Admin 深测过程（旧部署复现）：`docs/review/2026-02-09_05-56-38-admin-deep-audit.md`
- API 契约审计（旧部署复现）：`docs/review/2026-02-09_05-56-38-api-contract-audit.md`

