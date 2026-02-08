# Plan: 线上闭环修复交付（安全止血 → 部署一致性 → Admin 可用 → 数据补全 → 契约收敛）

## Goal
- 以真实站点 `https://i.mukyu.ru` 为准完成“导入→补全→分类→强筛选/random”的可用闭环，并消除高危泄露面与 504/500 假可用。

## Scope
- In:
  - Security：ProxyEndpoint.password write-only + 全链路脱敏；/metrics 不裸奔（鉴权/默认关闭）。
  - Deploy：暴露 build/version/commit，修复部署一致性，确保线上版本可追溯且与仓库一致。
  - Admin：actions 深链/执行可用（hydrateMetadata/testRefresh/rebindPrimary/probe 等），长任务 job 化 + 可观测（jobId/状态/取消/重试）。
  - API：min_* 超界返回结构化 400（避免 Prisma P2020/500）。
  - Data：元信息补全覆盖率提升（width/height/tags/authors/xRestrict），/authors 不再恒为空，/random 强筛选可解释。
- Out:
  - 大型前端重写（除非为修复 AdminJS 行为所必需）。

## Assumptions / Dependencies
- 可访问真实站点并具备 Admin 登录态（不在仓库/日志/证据中落盘任何完整凭据）。
- 生产部署需要人工执行（当前 CI 仅跑 lint/tests），因此“线上复验”可能暂时标记 `blocked:prod_redeploy_required`，但不得伪造通过。

## Phases
1. 安全止血：`SEC-0001` → `SEC-0002`
2. 部署一致性与可追溯：`DEP-0001`（为后续所有线上复验提供 commit 证据链）
3. Admin 闭环恢复：`ADM-0001` → `ADM-0002` → `ADM-0003` → `ADM-0004` → `ADM-0005`
4. 数据补全价值兑现：`DATA-0001` → `DATA-0002`
5. API 契约收敛：`API-0001`
6. 全量回归与审计落盘：`REG-0001`

## Tests & Verification
- ProxyEndpoint.password 不回显/不返回 -> vitest + Chrome MCP 复验（截图+network/console 脱敏摘要）。
- Admin actions 不再 not found/504 -> vitest + Chrome MCP 触发动作并观察 notice/job 状态。
- TokenProxyBinding 资源页 500 -> vitest + 线上资源页 list/show。
- min_* 超界 -> vitest + curl 真实请求（期望 400）。
- 元信息补全 -> job 测试 + 线上 `/random?format=json` 与 `/authors` 抽样复验（记录 request_id 与覆盖率）。
- /metrics 安全 -> vitest + curl HEAD（401/404 按策略）。

## Issue CSV
- Path: `issues/2026-02-09_05-56-38-full-remediation.csv`
- 与本 plan 使用同一时间戳。

## Tools / MCP
- `chrome-devtools:*`：真实站点 Admin 全覆盖回归（pages/resources/actions）+ 截图与 network/console 脱敏摘要取证。

## Acceptance Checklist
- [ ] ProxyEndpoint.password 全链路 write-only（Admin API/UI/日志/审计均无明文）
- [ ] /metrics 不裸奔（按安全默认值/鉴权策略）
- [ ] /healthz 或 /version 暴露 build/version/commit/build_time（可追溯线上运行版本）
- [ ] Admin 关键 actions 深链可打开，执行不 504，返回可解释 notice/jobId
- [ ] TokenProxyBinding 资源页 list/show 可用，能力与自定义页一致或明确边界
- [ ] `/random` 与 `/images` 的 `min_*` 超界返回 400（结构化错误包）
- [ ] 元信息补全可批量推进，`/authors` 不再恒为空，`/random` 强筛选可解释
- [ ] `npm run test:all` + 回归脚本通过；本轮 docs/review 与根报告更新完备

## Risks / Blockers
- `blocked:prod_redeploy_required`：CI 不自动部署，线上复验依赖人工部署；未部署前不得将线上复验标记为 DONE。
- Cloudflare 超时预算：任何长耗时动作必须 job 化并在入队层设 timeout guard（<10s 返回）。
- 上游 Pixiv 限流/不稳定：补全链路需退避/熔断/限速，并允许 `blocked:pixiv_upstream_rate_limit` 但不得假通过。
- 证据/日志泄露风险：只落盘脱敏摘要；若误落盘必须立即删除并以 `.summary.txt` 替代。

## Rollback / Recovery
- DB 迁移：按 `docs/deployment/db-migrations.md` 执行；每次变更必须提供回滚路径。
- 导入回滚：由 `DATA-0002` 引入 import_id 级回滚（禁用/删除本次新增）并记录 AdminAudit。

## Checkpoints
- Commit after: 每个 issue 1 个 commit（包含代码/证据/CSV 状态更新）；push 后进入下一条。

## References
- 本轮 Admin 审计：`docs/review/2026-02-09_05-56-38-admin-deep-audit.md`
- 本轮 API 审计：`docs/review/2026-02-09_05-56-38-api-contract-audit.md`
- 关键证据目录：`docs/review/screenshots/2026-02-09_05-56-38/`、`docs/review/network/2026-02-09_05-56-38/`、`docs/review/console/2026-02-09_05-56-38/`

