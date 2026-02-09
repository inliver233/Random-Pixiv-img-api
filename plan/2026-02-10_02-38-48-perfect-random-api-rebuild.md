# Plan: Perfect Random API Rebuild（闭环打通 + Admin 全可用 + 可运维）

## Goal
- 以“导入大量图片 → 使用 refreshToken + 代理池补全元数据 → 分类（作者/标签/R18/尺寸等）→ 高度可筛选的随机图片 API”为唯一业务闭环，做到：
  - 闭环可跑通、可观测、可恢复（失败可解释、可重试/回滚）
  - Admin 全页面/全资源/全 actions 可用（不再出现“找不到网页/无组件”假可用）
  - 安全红线：refreshToken/password 等 **write-only**（任何 API/日志/审计/页面不回显明文）
  - 代码质量：高内聚、低耦合、测试覆盖关键路径，便于扩展（更多筛选维度/更多代理策略/更多导入源）

## Scope
- In:
  - 修复线上深测报告暴露的所有 High/Medium/Low 缺陷，并补齐缺失的“可观测/可恢复/可解释”链路
  - 重构 AdminJS actions 体系：任何在 UI 可见的 action 必须可点击执行或给出明确跳转/替代路径
  - 打通数据闭环：Import 产出 Image；Hydration 产出 tags/authors/r18/尺寸；/random 返回 200/302
  - 强化筛选能力与契约（包含 multi-value tags 等），并补齐 OpenAPI/文档
- Out（本计划不强制做，但允许后续追加 issue）:
  - 引入外部图像变换服务（imgproxy）与签名 URL
  - 迁移到全新前端框架或替换 AdminJS（可在后续独立 epics 做）

## Assumptions / Dependencies
- 需要可用的 PostgreSQL（`DATABASE_URL`）与 pg-boss schema（本仓库已有）
- Pixiv 上游可用性不可控：所有冷路径任务必须支持重试/退避/熔断，并在 UI 中可解释
- 代理池可能包含 `@` 密码：全链路必须严格脱敏（本计划文件/Issue CSV 不含任何明文凭据）

## Phases
1. 计划落盘 + 迭代执行框架（issue/plan/测试/提交策略）
2. 安全红线 + Admin 可用性止血（refreshToken 不回显、actions 深链可用、AdminJobs 可观测）
3. 闭环打通（Import → Image 增长可见；Hydration 可运行并产出分类数据）
4. 随机 API “高可用 + 高筛选”完善（/random 200/302、filters multi-value、契约/文档一致）
5. 可维护性与性能深化（索引/随机抽样/缓存策略/错误分级/告警面板）

## Tests & Verification
- Security（write-only/脱敏） -> `npx vitest run test/admin_audit_redaction.test.ts` + 增量测试用例
- Admin Actions 可用性（deep link） -> `npm run smoke:admin-ui:strict`（本机）+ Chrome DevTools MCP（部署后）
- Import 闭环 -> 集成测试（Docker Postgres）+ 手工：ImportUrls 导入 100 行后 `Image>0`
- Hydration/分类 -> 触发 `Image.hydrateMetadata` / backfill，验证 tags/authors/r18/尺寸落库
- API 契约 -> `docs/review/artifacts/**/api/*.headers/body` 对齐 + 新增 contract test
- 全量回归 -> `npm run test:all`

## Issue CSV
- Path: `issues/2026-02-10_02-38-48-perfect-random-api-rebuild.csv`
- 与本 plan 共享同一时间戳/slug（硬规则）

## Tools / MCP
- `chrome-devtools`：Admin UI 深链与动作验证（部署后必做）
- `shell`：本机运行 `docker compose`、`vitest`、`smoke`、`curl` 验证

## Acceptance Checklist
- [ ] 导入 100+ pximg 原图 URL 后，`/admin/resources/Image` 记录数可见增长（>0）
- [ ] 至少 3 条 Image 可完成 hydrateMetadata，且 tags/authors/r18/尺寸写入 DB
- [ ] `/random`（image/json/redirect）在有数据时可稳定返回（失败自动换图重试）
- [ ] Admin `/admin/pages/*` 全可达；`/admin/resources/*` 全可达；所有可见 actions 可执行或明确跳转
- [ ] refreshToken/password 绝不回显（API/日志/审计/页面/截图）
- [ ] `npm run test:all` 通过

## Risks / Blockers
- 上游 Pixiv/代理不可用会导致 hydration 失败：必须确保失败“可见 + 可重试 + 不影响热路径”
- 生产部署若仍使用 stale 构建，会造成“仓库已修复但线上仍坏”：需要加入部署一致性校验

## Rollback / Recovery
- 每个 issue 独立 commit（`test` 分支），可按 commit 回滚
- Import/Backfill 提供 rollback（disable/delete）与 DLQ 重试/清空

## Checkpoints
- Commit after: **每个 issue（单 issue 单 commit）**，并在 commit message 前缀包含 Issue ID

## References
- 真实站点深测总报告：`../../第二次最详细页面和功能实现问题.md`
- Admin 深测过程：`../../docs/review/2026-02-09_15-20-48-admin-deep-audit.md`
- API 契约审计：`../../docs/review/2026-02-09_15-20-48-api-contract-audit.md`
- 核心实现入口：`app.ts:79`、`src/admin/adminJs.ts:469`、`src/routes/adminImport.ts:167`

