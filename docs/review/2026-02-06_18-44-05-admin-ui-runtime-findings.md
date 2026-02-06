# Admin UI Runtime Findings (2026-02-06_18-44-05)

## 巡检方式（Chrome DevTools MCP）
- 浏览器：`mcp__chrome-devtools__*`
- 鉴权方式：通过本地转发代理注入 `x-admin-token`（凭据仅运行时内存使用，未明文落盘到仓库文档）
- 巡检地址：`http://127.0.0.1:3915/admin`（代理后端 `http://127.0.0.1:3015`）

## 覆盖范围与状态
| 模块 | 页面 | 结果 | 证据 |
|---|---|---|---|
| Dashboard | `/admin` | 可访问 | `docs/review/screenshots/2026-02-06_18-44-05/dashboard.png` |
| Import | `/admin/pages/importUrls` | 可访问（表单存在可用性问题） | `docs/review/screenshots/2026-02-06_18-44-05/import.png` |
| Proxy | `/admin/pages/easyProxiesImport` | **页面未渲染（未指定组件）** | `docs/review/screenshots/2026-02-06_18-44-05/proxy-easy-import-broken.png` |
| Proxy | `/admin/pages/proxyPoolOverview` | **页面未渲染（未指定组件）** | `docs/review/screenshots/2026-02-06_18-44-05/proxy-pool-overview-broken.png` |
| Token | `/admin/resources/PixivToken` | 页面可达但列表请求 500 | `docs/review/screenshots/2026-02-06_18-44-05/token-resource-error.png` |
| Token Proxy Binding | `/admin/pages/tokenProxyBindings` | **页面未渲染（未指定组件）** | `docs/review/screenshots/2026-02-06_18-44-05/token-proxy-binding-broken.png` |
| Hydration | `/admin/pages/hydrationOps` | **页面未渲染（未指定组件）** | `docs/review/screenshots/2026-02-06_18-44-05/hydration-broken.png` |
| Audit | `/admin/resources/AdminAudit` | 页面可达（当前数据为空） | `docs/review/screenshots/2026-02-06_18-44-05/audit.png` |
| Logs | `/admin/resources/RequestLog` | 页面可达但列表请求 500 | `docs/review/screenshots/2026-02-06_18-44-05/logs.png` |
| Navigator | `/admin/pages/opsNavigator` | **页面未渲染（未指定组件）** | `docs/review/screenshots/2026-02-06_18-44-05/ops-navigator-broken.png` |

## 关键问题清单（按严重度）

### P0 - 自定义页面组件注册/打包链路失效（运行时硬故障）
- 现象：多个关键页面显示 `未指定组件 / 您必须指定将呈现此元素的组件`。
- 影响：Proxy、Binding、Hydration、Navigator 等管理核心功能不可用。
- 推断：`adminJs.ts` 的 page component 注册与实际 bundle 产物/路径不一致（API 可返回，但前端组件未挂载）。

### P1 - 资源列表在 DB 不可用时直接 500，缺少友好降级
- 现象：`/admin/api/resources/PixivToken/actions/list` 与 `/admin/api/resources/RequestLog/actions/list` 返回 500。
- 证据：DevTools Network 显示 500；`RequestLog` 返回体含 `{"code":"P1001"...}`。
- 影响：运维在依赖故障场景下无法从 UI 快速定位恢复路径。

### P2 - 前端质量噪声
- 每页 `favicon.ico` 固定 400（噪声请求）。
- i18n `missingKey zh-CN` 大量刷屏（导航、labels、pages 多项缺失）。
- Import 页面出现可访问性 issue（无 label / id/name 警告），并出现重复“Import”按钮的认知噪声。

## 控制台/网络证据摘要
- 控制台：大量 i18next missingKey；资源页出现 500 请求错误。
- 网络：
  - `GET /admin/api/resources/PixivToken/actions/list` -> 500
  - `GET /admin/api/resources/RequestLog/actions/list` -> 500（`P1001`）
  - `GET /favicon.ico` -> 400（各页重复）

## 结论
- 当前 Admin UI 的**主要阻断点不是后端 API 不存在**，而是**前端自定义页面组件无法挂载**。
- 需优先修复页面注册/打包路径，再做文案统一与空态体验增强；否则 CSV 中相关 `DONE` 与真实可用性不一致。
