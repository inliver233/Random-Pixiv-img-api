# Plan: Second Round Execution（以闭环为唯一目标：导入→补全→分类→随机 API）

## Goal
- 以真实站点 `https://i.mukyu.ru` 的审计证据为准，最终交付一个“可跑通、可观测、可恢复、可维护”的闭环：
  1) Admin 导入大量 Pixiv 原图 URL（支持代理池 URI 导入）  
  2) 使用 refreshToken + 代理池冷路径补全元数据（作者/标签/R18/宽高等）  
  3) 基于元数据完成分类检索（`/tags` `/authors` `/images`）  
  4) `/random` 支持强筛选并高可用（失败自动换图重试；可返回 image/json/redirect）

## Scope
- In:
  - 修复线上深测暴露的 High/Medium/Low（以 `第二次最详细页面和功能实现问题.md` 为准）
  - AdminJS：所有可见 actions 必须可执行（或明确跳转到可执行入口），并且可追溯（jobId/request_id）
  - 数据闭环：Import 必须能产出 Image；Hydration 必须能落库关键字段与 tags
  - API 契约：多值 tags、legacy page=0 语义、错误包一致性、OpenAPI/文档对齐
  - 部署可追溯：/healthz + /version 暴露 build 信息；提供 smoke 校验脚本与发布检查清单
- Out:
  - 引入 imgproxy 等外部图像变换服务（可后续单独 epic）
  - 替换 AdminJS（如需更换，应另起独立 plan）

## Assumptions / Dependencies
- Postgres + pg-boss schema 可用（`DATABASE_URL` 已配置）；否则 job/导入/补全不可用。
- 线上复验需要人工 redeploy；未 redeploy 前，线上验证一律标记 `blocked:prod_redeploy_required`（不得伪造通过）。
- 任何证据与仓库文件不得写入完整凭据（token/password/refresh_token/proxy password）。

## Phases
1. 固化执行合同：生成/维护本 plan + issue CSV，并对齐已落地提交的状态（避免“修了但 CSV 仍 TODO”）。
2. 先修“可观测 + 安全红线”：refreshToken/write-only、全局脱敏、AdminJobs 队列全可见、action→job→跳转链路。
3. 打通闭环：Import 产出 Image（可见增长）→ Hydration 落库分类字段与 tags → /random 在有数据时稳定 200/302。
4. 收敛 API 契约与可用性：tags 多值解析、legacy page=0、/metrics 策略文档化、空态/异常态与反馈语义一致。
5. 全量回归与证据更新：本地 `npm run test:all` +（redeploy 后）Chrome MCP 全覆盖 pages/resources/actions + API 契约矩阵落盘。

## Tests & Verification
- Security（write-only/脱敏） -> `npx vitest run test/admin_audit_redaction.test.ts test/pixivTokenResource.test.ts test/admin_proxy_endpoint_writeonly.test.ts`
- Admin actions 深链可用 -> `npx vitest run test/admin_action_component_contract.test.ts test/admin_image_actions.test.ts`
- Import 闭环 -> `npx vitest run test/admin_import.test.ts test/admin_import_contract.test.ts`
- Hydration 落库 -> `npx vitest run test/job_hydrate_metadata.test.ts test/job_hydrate_fields_*.test.ts`
- API 契约 -> `npx vitest run test/randomContract.test.ts test/images_get.test.ts test/legacyRoutesContract.test.ts`
- 全量回归 -> `npm run test:all`

## Issue CSV
- Path: `issues/2026-02-10_04-21-53-second-round-execution.csv`
- Must share the same timestamp/slug as this plan.

## Tools / MCP
- `chrome-devtools`：线上 Admin 深层动作复验（redeploy 后必跑，截图/网络/控制台需脱敏落盘）
- `shell`：本机运行 `vitest` / `docker compose` / `curl` / smoke 脚本

## Acceptance Checklist
- [ ] 导入 100+ 条 pximg 原图 URL 后，`/admin/resources/Image` 记录数 > 0，且 Import 可追溯到 jobId/进度
- [ ] 至少 3 个不同 illust 可完成 hydration（写入 tags/作者/R18/宽高）
- [ ] `/random`（image/json/redirect）在有数据时稳定返回；失败会自动换图重试且不超过 attempts
- [ ] `/admin/pages/*` 全可达；`/admin/resources/*` 全可达；所有可见 actions 可执行或明确跳转
- [ ] tags 多值解析（重复 query/逗号/`|`）在 `/random` 与 `/images` 一致且有测试
- [ ] legacy `/:illustId-:page.:ext` 的 `page=0` 语义明确且回归测试覆盖
- [ ] /healthz 与 /version 含 `version/commit/build_time`；部署前 smoke 可比对 commit（无敏感信息）
- [ ] `npm run test:all` 通过

## Risks / Blockers
- `blocked:prod_redeploy_required`：线上复验依赖人工部署；未部署前不得将线上复验标记 DONE。
- Pixiv 上游/代理不可控：补全必须退避/熔断/限速，并在 UI 中可解释（而不是“看起来成功但其实没做事”）。

## Rollback / Recovery
- 每个 issue 单独 commit（`test` 分支），可按 commit 回滚。
- Import rollback 走 job（disable/delete）并落审计；DLQ 任务可 retry/delete 并落盘证据。

## Checkpoints
- Commit after: 每个 issue（单 issue 单 commit + 必测 + 更新 CSV 状态）

## References
- 真实站点深测总报告：`../../第二次最详细页面和功能实现问题.md`
- Admin 深测过程：`../../docs/review/2026-02-09_15-20-48-admin-deep-audit.md`
- API 契约审计：`../../docs/review/2026-02-09_15-20-48-api-contract-audit.md`

