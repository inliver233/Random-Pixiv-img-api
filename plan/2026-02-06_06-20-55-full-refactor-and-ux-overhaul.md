---
mode: plan
task: Full Refactor and UX Overhaul
created_at: "2026-02-06T06:20:55+08:00"
complexity: complex
---

# Plan: Full Refactor and UX Overhaul

## 目标
- 在不回归既有线上能力的前提下，完成一轮“审计驱动”的系统性重构：后端稳定性、代理导入体验、Admin UI 一致性、测试回归与运维文档一次收口。
- 将 easy_proxies 与手动代理导入流程统一为“极简输入 + 立即生效”的单入口体验。
- 让后台页面在信息架构、视觉、文案、交互反馈上统一风格，减少中英混杂与认知负担。

## 范围
- In:
  - 历史 commit 与历史 CSV 审计结论落盘，并对识别出的高优先问题逐项修复。
  - 后端：代理 URI 批量导入能力、运行时热更新链路、分类接口契约一致性补强。
  - easy_proxies 对接：支持一行 URI（含认证/特殊字符）与多行批量导入，保存后立即可被代理池使用，无需重启。
  - Admin UI：组件风格 ADR、导航重构、关键页面统一视觉/文案/交互反馈（Import、Proxy、Token、Binding、Hydration、Dashboard、Audit、Logs）。
  - 测试：新增功能单测/集成测试 + UI 关键链路 smoke 脚本 + 全量回归。
  - 文档：用户手册、运维手册、easy_proxies 对接说明、compose 部署与排障、安全清单。
- Out:
  - 不引入新的前端框架重写后台（继续基于 AdminJS 扩展）。
  - 不引入分布式配置中心（保持当前 DB + runtime cache 模式）。

## 非目标
- 不承诺绕过上游风控，仅优化稳定性与可观测性。
- 不改动业务侧图片推荐算法与数据语义。

## 风险
- AdminJS 单文件逻辑集中（`src/admin/adminJs.ts`）导致改动回归半径大。
- Docker daemon 在本机可能不可用，compose 冒烟可能受限。
- 代理密码、token 等敏感字段在导入与日志链路中存在泄露风险，必须严格脱敏。

## 回滚策略
- 新增功能以“附加能力”方式引入，不破坏原有路径：
  - URI 导入失败时不影响已有 ProxyEndpoint。
  - UI 改动仅改前端组件与资源 action，不改数据库结构。
- 若出现问题，可通过回退到前一提交恢复，不需要数据迁移回滚。

## 里程碑
1. 审计落盘与差距确认（commit/csv/runtime）。
2. 极简代理导入链路（后端 + UI + 即时生效）。
3. Admin UI 信息架构与视觉统一。
4. 测试脚本补齐与全量回归。
5. 文档与部署/安全说明收口。

## 前后端分层重构策略
- 后端：把代理 URI 导入解析逻辑从 Admin action 中抽离为独立模块（import service），减少 `adminJs.ts` 的业务耦合。
- 前端：统一页面 token（字体、色彩、间距、状态色、卡片/按钮样式），页面仅组合组件，不重复定义视觉规则。
- 契约层：通过集成测试锁定 `/random`、`/i`、`/images`、`/healthz`、`/metrics`、`/admin` 与 legacy 行为。

## UI 重构策略
- 信息架构：统一“导航页 -> 操作页 -> 资源页”路径，避免跨页跳转迷路。
- 组件库 ADR：继续使用 AdminJS + Design System，禁止混入第二套组件库。
- 设计 Token：集中在 `src/admin/pages/uiKit.js`，禁止页面内散落重复样式常量。
- 视觉规范：浅底、留白、清晰层级，统一中文文案风格，减少中英混杂。
- 无障碍：按钮禁用态、错误色对比度、表单错误提示可读。
- 响应式：关键面板在窄屏下单列展示，避免横向溢出。

## easy_proxies 对接简化策略
- 新增“URI 直接导入”入口（支持单行/多行），输入后直接写入 ProxyEndpoint 并触发 runtime cache 失效。
- 兼容 `http://user:pass@host:port` 与密码含 `@`（支持明文最后一个 `@` 分隔 + `%40` 编码）。
- 保留 easy_proxies `/api/export` 导入能力，与手动 URI 导入并存。
- 导入结果返回 imported/invalid/conflicts，提供可复用反馈。

## 测试矩阵
- 单测：URI 解析/批量导入/密码特殊字符解析/去重。
- 集成：Admin resource action 导入后端点是否落库并可被 runtime 读取。
- 契约：核心 API 与 legacy 路由。
- 冒烟：UI 关键链路（Import -> Proxy 导入 -> Dashboard 校验）脚本化。
- 回归：`npm run test:all` + `pwsh test/proxy-smoke.ps1` + compose（可用时）。

## 发布与验证计划
- 发布前：执行 issue 粒度验证 + 全量回归。
- 发布后：检查 `/healthz`、`/metrics`、Admin 页面与代理导入即时生效。
- 若 compose 环境可用，执行 `docker compose up -d` 并验证 migrate/backend/postgres/memcached 状态。

## Issue CSV
- `issues/2026-02-06_06-20-55-full-refactor-and-ux-overhaul.csv`
