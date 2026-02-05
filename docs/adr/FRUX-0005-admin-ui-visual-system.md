# ADR FRUX-0005: Admin UI Visual System and Token Strategy

- Status: Accepted
- Date: 2026-02-06
- Owner: pixivcat-backend

## Context

上一轮功能快速迭代后，Admin 页面出现以下问题：

- 页面样式常量散落在多个文件，视觉不一致。
- 文案与层级风格混杂，页面反馈与按钮状态不统一。
- 导入、代理、仪表盘等高频页面缺少统一设计 token 和组件约束。

我们需要在不重写 AdminJS 的前提下，完成可持续维护的视觉系统收敛。

## Decision

采用 **AdminJS + 本地 uiKit token 层** 的单栈方案，不引入第二套组件库。

核心决策如下：

1. 所有关键页面统一复用 `src/admin/pages/uiKit.js` 的设计 token。
2. token 覆盖字体、色彩、边框、半径、阴影、按钮、输入框、卡片、提示块。
3. 页面层只负责布局和语义，不再内联重复视觉样式。
4. 风格目标为“简洁、留白、层次明确、反馈可感知”，保持苹果式清晰体验并兼顾实现成本。

## Consequences

### Positive

- 关键页面视觉一致，维护成本下降。
- 后续新增页面可直接复用 token，避免样式漂移。
- 错误/警告/成功反馈风格统一，降低操作风险。

### Trade-offs

- 仍基于 AdminJS 渲染体系，细粒度交互能力不及自建 SPA。
- 旧页面改造需要逐步推进，短期内会有过渡状态。

## Implementation Notes

- 已在 `uiKit.js` 增加 token 与样式工厂：
  - `createCardStyle`
  - `createCalloutStyle`
  - `createInputStyle`
  - `createTextareaStyle`
  - `createButtonStyle`
  - `pageTitleStyle`
- 首批落地页面：
  - `dashboard.jsx`
  - `importUrls.jsx`
  - `easyProxiesImport.jsx`

## Verification

- 手工核对页面层级、按钮状态、提示色和输入控件一致性。
- 通过 lint / 测试保障改造未破坏现有功能链路。
