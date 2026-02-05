# Admin UI Style Guide（AdminJS）

> 适用范围：`src/admin/pages/*` 的自定义页面（dashboard / import / hydration / proxy / token 相关页面）。

## 1. 设计栈决策（与 ADR 一致）

- 组件栈：继续使用 **AdminJS + 自定义 React 页面**，不引入新的重型 UI 框架。
- 视觉基线：优先沿用 AdminJS 风格，不做“另起一套后台皮肤”。
- 目标：保证可维护性与一致性，避免不同页面出现风格漂移。

## 2. 统一样式 Token

统一在 `src/admin/pages/uiKit.js` 维护：

- `adminUiTokens.fontFamily`: `IBM Plex Sans + Noto Sans SC + 系统中文字体回退`
- `adminUiTokens.text`: `#111827`
- `adminUiTokens.muted`: `#6b7280`
- `adminUiTokens.border`: `#e5e7eb`
- `adminUiTokens.radius`: `12`

复用 helper：

- `pageRootStyle`：页面根容器（padding + font + 轻背景）
- `pageCardStyle`：卡片边框/圆角/内边距
- `mutedTextStyle`：次级文案
- `createButtonStyle(...)`：中性/主按钮/危险按钮

## 3. 信息架构与导航约束

后台页面统一按业务流组织：

1) 导入与图片
2) 补全
3) 代理
4) 令牌
5) 统计与审计

要求：

- 新页面必须能归入上述分组；若不能归组，需先补 ADR 或 issue 说明。
- 高风险操作（删除、关闭代理、DLQ 重试）必须有明确提示文案。
- Dashboard 需要提供到关键流程页的快捷入口（减少误点路径）。

## 4. 交互约束

- 任何写操作必须提供：
  - 正在执行态（disabled/loading）
  - 成功/失败 notice
  - 可追溯审计（AdminAudit）
- 表格视图优先保留可扫描性：
  - 固定列含义
  - 空状态文案明确（不是空白）
- 错误信息遵循：`code + message` 优先，其次才是原始堆栈。

## 5. 新页面准入 Checklist

提交前至少满足：

- [ ] 使用 `uiKit` 的 token 或 helper（不再手写一套新色板）
- [ ] 页面属于五大分组之一
- [ ] 高风险操作有确认提示
- [ ] 操作结果有 notice
- [ ] lint 通过（`npm run lint`）
- [ ] 至少有 1 条可复现验收路径（自动化或 manual checklist）
