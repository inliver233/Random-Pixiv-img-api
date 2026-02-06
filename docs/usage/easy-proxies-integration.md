# easy_proxies 对接与部署建议

本文说明如何让 pixivcat-backend 与 `easy_proxies` 对接，并给出推荐部署形态与安全建议。

## 1. easy_proxies 是什么（在本项目中的定位）
- easy_proxies 负责“代理节点池管理”：订阅/节点、探测、导出代理入口
- pixivcat-backend 负责“业务侧策略”：域名路由、token↔proxy 绑定、失败重试与切换、审计与指标

因此推荐将 easy_proxies 当作 **proxy provider**，由 pixivcat-backend 定期/手动从 easy_proxies 导入节点（`/api/export`）并落库。

## 2. 推荐模式：pool / multi-port / hybrid

easy_proxies 常见模式（命名以 easy_proxies 为准）：
- **pool**：所有节点共享同一监听端口（统一入口）
- **multi-port**：每个节点独立监听端口
- **hybrid**：既提供 pool 入口，也提供 multi-port 入口

对 pixivcat-backend 的推荐：
- 优先 **hybrid** 或 **multi-port**  
  原因：便于做更稳定的“节点级”健康与绑定（token↔proxy），减少 pool 模式下的“黑盒漂移”。

## 3. /api/export 导入协议（必须兼容）
pixivcat-backend 对接的最小契约：
- easy_proxies `GET /api/export` 返回 **纯文本**（`text/plain; charset=utf-8`），每行一个代理 URI，例如：
  - `http://1.2.3.4:12345`
  - `http://user:pass@1.2.3.4:12345`
- 在 hybrid 模式下，easy_proxies 会优先导出 multi-port（每节点独立端口）格式（更稳定）。

### 3.1 如果 easy_proxies 开启了密码：/api/auth
如果 easy_proxies 配置了管理密码，需要先登录：
```bash
curl -fsS -X POST http://<easy_proxies_host>:<port>/api/auth \\
  -H 'Content-Type: application/json' \\
  -d '{\"password\":\"<password>\"}'
```

响应 JSON 中会返回 `token`。之后调用受保护接口时：
```bash
curl -fsS http://<easy_proxies_host>:<port>/api/export \\
  -H 'Authorization: Bearer <token>'
```

> 说明：easy_proxies 同时会设置 `session_token` cookie；pixivcat-backend 对接时使用 Bearer token 更简单。

## 4. pixivcat-backend 侧配置建议
建议在后台（AdminJS）配置以下信息（DB 为运行时权威，env 仅做默认兜底）：
- `easy_proxies_base_url`：例如 `http://easy-proxies:9090`
- `easy_proxies_password`（可选）：用于自动调用 `/api/auth` 获取 token
- `easy_proxies_refresh_interval_seconds`（可选）：定时刷新代理列表的周期

导入方式建议：
- 管理端提供“一键导入/刷新”动作（手动触发）
- 可选：定时任务自动刷新（避免节点变更后长期不更新）

## 4.1 极简配置：一行 URI 直接导入（无需重启）

后台页面：`/admin/pages/easyProxiesImport`

支持直接粘贴单行/多行 URI：

```text
http://user:pass@host:port
socks5://host:port
http://user:pa@ss@host:port
```

要点：
- 密码中含 `@`：支持“最后一个 `@` 作为分隔”的写法，也支持 `%40` 编码。
- 批量导入：每行一个 URI，可混合 `http/https/socks4/socks5`。
- 保存后立即生效：导入动作会自动触发 runtime proxy cache 失效，不需要重启 backend。
- 冲突策略建议：`skip_non_source`（避免覆盖不属于当前来源的节点）。

### 4.1.1 推荐操作步骤（运营侧）
1. 打开 `Admin -> easy_proxies 导入`（`/admin/pages/easyProxiesImport`）。
2. 直接粘贴文本（单行或多行）。支持以下两种密码写法：
   - 原始 `@`：`http://user:pa@ss@host:port`
   - 百分号编码：`http://user:pa%40ss@host:port`
3. 选择冲突策略（推荐 `skip_non_source`），点击导入。
4. 查看结果摘要：`imported / invalid / conflicts`。
5. 若存在错误，直接根据行号修正后再次导入（无需重启服务）。

### 4.1.2 错误反馈示例（“说人话”）
- `line=7` + `Proxy URI must include scheme...`：该行缺少 `http://` / `socks5://` 前缀。
- `line=12` + `Invalid proxy port...`：端口非法（非数字或超出范围）。
- `line=21` + `IPv6 addresses must be wrapped in [ ]`：IPv6 未用方括号包裹。

证据截图：
- `docs/review/screenshots/2026-02-06_19-14-04/arux-0004-easy-import-summary.png`
- `docs/review/screenshots/2026-02-06_19-14-04/arux-0005-proxy-overview-unified.png`

## 5. Docker Compose 部署建议

### 5.1 建议 1：easy_proxies 外置（推荐）
优点：组件边界清晰，可独立升级/重启，不影响 pixivcat-backend。

- easy_proxies 单独一套 compose，暴露管理端口到 **内网**（不要直接公网暴露）
- pixivcat-backend 通过内网访问 `easy_proxies_base_url`

### 5.2 建议 2：与 pixivcat-backend 同 compose（可选）
适合一体化部署/小规模自用。

要点：
- easy_proxies 管理端口只暴露到内部网络
- 通过 compose network 互通：pixivcat-backend 配置 `easy_proxies_base_url=http://easy-proxies:9090`

## 6. 安全建议（强烈建议照做）
- **必须设置 easy_proxies 管理密码**（否则 `/api/auth` 会提示“无需密码”，等价于开放所有管理 API）
- easy_proxies 管理端口不要直接暴露公网；如必须暴露，至少加反代鉴权与 IP allowlist
- pixivcat-backend 管理后台同样建议启用 `ADMIN_IP_ALLOWLIST`、CSRF、审计
- 代理 URI 中的 `user:pass` 与 Pixiv `refresh_token` 都是高敏感信息：
  - 禁止明文日志与明文 API 返回
  - 后台展示必须脱敏
  - 建议落库加密（按本项目实现策略）

## 7. 可选增强：/api/nodes /api/debug 健康映射
easy_proxies 提供节点状态与探测信息接口（例如 `/api/nodes`、`/api/debug`）。
pixivcat-backend 可选择把这些信息映射成 ProxyEndpoint 的健康评分输入，以提升调度稳定性；
但核心转发与选择逻辑不应依赖这些接口的可用性（避免外部管理面抖动影响业务主链路）。

## 8. 常见排障

- 导入后看不到节点：
  - 检查 `easy_proxies_base_url` 是否可达
  - 检查 `source` 过滤与冲突策略是否把新节点跳过
  - 检查后台通知中的 `invalid/conflicts` 计数
- 提示认证失败：
  - 确认 easy_proxies 管理密码是否变更
  - 重新保存配置后再执行导入
- 导入成功但请求仍不走代理：
  - 检查全局代理开关（Dashboard “代理出站”）
  - 检查 fail-open/fail-closed 与域名路由配置

## 9. 回归验证清单（本轮）

```bash
# 重点单测（组件 bundle + URI 导入）
npx vitest run test/admin_components_bundle_route.test.ts test/proxyUriImporter.test.ts

# 全量回归（lint + 全量测试 + smoke）
npm run test:all

# Admin UI smoke（按需传入 token）
pwsh -NoProfile -File test/admin-ui-smoke.ps1 -BaseUrl http://127.0.0.1:3015 -AdminToken <ADMIN_TOKEN>
```

说明：
- 当 `AdminToken` 为空时，smoke 脚本会退化为“仅验证后台受保护”模式（返回 401/403/302/503 都视为受保护）。
- 若在受限环境无法启动 compose，可先执行 `docker compose -f docker-compose.yml config --services` 完成结构校验。
