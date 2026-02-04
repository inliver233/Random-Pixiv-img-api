# ADR PPOOL-0005: 后台 UI 与组件库选型

- Status: Accepted
- Date: 2026-02-05
- Issue: PPOOL-0005

## Context
本批次需要在后台（AdminJS）新增/增强多个管理与观测页面：
- token / proxy / pool / binding / runtime settings 的 CRUD 与动作（导入/刷新/健康检查/rebind 等）
- 补全（hydrate/backfill）的运行面板、DLQ 排障入口
- 代理池概览与可观测指标

约束：
- 本仓库已采用 AdminJS，且现有后台与资源/页面已在运行中（`src/admin/adminJs.ts`）。
- 需求强调“避免乱引入导致维护爆炸”，需要先做 ADR 决策并保持一致的 UI 风格。
- 本批次优先保证功能与可维护性，避免把交付阻塞在“自研后台重写”上。

因此需要明确：
- 是否继续使用 AdminJS 及其 Design System；
- 是否引入额外组件库（MUI/Antd/Chakra/Tailwind 等）；
- 自研后台（独立 SPA）是否纳入本批次；
- 页面风格与交互约束如何落地（后续用 style guide 固化）。

## Decision
本批次 **继续以 AdminJS 为唯一后台入口**，并以 **AdminJS Design System** 作为统一组件与样式体系：

1) **AdminJS 继续作为后台承载**
   - CRUD（资源管理）优先使用 AdminJS Resource；
   - 自定义页面/动作（dashboard、导入、绑定视图、观测面板等）使用 AdminJS 的自定义组件与页面机制实现。

2) **组件库选择：只使用 AdminJS Design System**
   - 自定义页面统一使用 `@adminjs/design-system` 提供的组件（布局、表格、按钮、提示等）；
   - 不在本批次引入新的通用组件库（避免 CSS/主题系统冲突与 bundle 体积膨胀）。

3) **不做事项（本批次明确 Out of scope）**
   - 不实现独立的后台 SPA（React/Vue/Next.js 等）；
   - 不引入 Tailwind / Ant Design / Material UI 等额外 UI 框架；
   - 不做复杂的多主题/暗黑模式等非必要视觉工程（如需，后续单独 ADR/Issue）。

4) **可迁移路线（未来演进）**
   - 若 AdminJS 无法满足更复杂的 UX（例如复杂可视化、权限模型、审计视图），可在后续引入独立后台 SPA；
   - 但本批次的页面实现需保持“数据/动作 API”与“UI 展示”分离：核心逻辑放在后端 service/repository 层，AdminJS 仅作为薄 UI。

## Rationale
- AdminJS 已存在且能快速落地 CRUD + 自定义动作，符合“热更新管理”目标。
- AdminJS Design System 与 AdminJS 内部风格一致，最小化样式冲突与维护成本。
- 额外组件库会带来依赖与样式体系冲突（尤其是 AdminJS 自带的样式/主题），并增加 bundle 体积与构建复杂度。
- “先交付可用、再迭代体验”更符合本批次的风险控制与交付节奏。

## Consequences
- 新页面需要遵循 AdminJS 的页面组织方式与 bundling 约束（后续通过 `docs/ux/admin-style-guide.md` 固化规范）。
- 若需要图表/复杂可视化，优先选择轻量库（按需评估），并尽量在服务器侧做聚合减少前端复杂度。

## Alternatives Considered
- 引入通用组件库（MUI/Antd/Chakra）：开发体验好但依赖重、样式冲突风险高，与“避免维护爆炸”目标冲突。
- Tailwind：对自研页面高效，但需要额外构建链与样式约束，且与 AdminJS 风格不一致。
- 自研后台 SPA：长期可能更好，但本批次成本与回归风险过高，不应阻塞核心代理池/绑定/热更新交付。

## References
- `src/admin/adminJs.ts`
- `src/routes/admin.ts`
- Issue CSV: `PPOOL-0005`

