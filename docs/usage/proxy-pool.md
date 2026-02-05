# 代理池与风控使用指南（Proxy Pool）

本文介绍 pixivcat-backend 的出站代理池能力：代理类型、域名路由、fail-open/fail-closed 策略、失败重试与切换、观测与风控建议。

> TL;DR  
> - 想尽量不暴露真实 IP：启用 fail-closed，并在部署侧加 egress 限制（更可靠）。  
> - 只想提升可用性：使用 fail-open（默认），并通过健康检查/黑名单减少坏节点影响。  
> - 推荐对接 easy_proxies：通过 `/api/export` 导入多端口节点，维护成本最低。

## 1. 能力概览

### 1.1 支持的代理类型
- `http://host:port`
- `http://user:pass@host:port`
- `https://host:port`（作为代理协议，不是目标协议）
- `socks4://host:port`
- `socks5://user:pass@host:port`

### 1.2 域名路由（默认 Pixiv Only）
默认仅 Pixiv 相关域名走代理：
- Pixiv OAuth（登录/刷新）
- Pixiv App API（作品详情等）
- pximg 图片源站（原图回源）

其他域名默认直连，避免误代理造成性能/可用性问题。

### 1.3 fail-open vs fail-closed（必须理解）
- **fail-open**（默认）：无可用代理时允许直连继续服务（可用性更高），但可能暴露真实 IP（风控风险更高）。
- **fail-closed**：无可用代理时直接失败（更安全，防止真实 IP 泄露），但可用性取决于代理池质量与健康检查。

建议：如果你的目标是“绝不泄露真实 IP”，请务必使用 fail-closed，并在部署侧做网络级 egress 限制（仅允许代理出口）。

补充：fail-open / fail-closed 支持**全局默认值**与**按域名覆盖**（子域名匹配）。优先级：
1) `proxy_fail_open_domains`（命中则强制 fail-open）
2) `proxy_fail_closed_domains`（命中则强制 fail-closed）
3) `proxy_fail_closed`（全局默认值）

## 2. 数据源与热更新（DB 为运行时权威）
代理池相关配置与资源支持后台热更新：
- ProxyEndpoint / ProxyPool 等资源在 DB 中持久化
- RuntimeSettings（运行时配置）在 DB 中持久化，并覆盖 env 默认值

env 仅作为启动期必需依赖与默认值兜底，不作为热更新通道。

## 3. 失败重试与切换（行为语义）
当出站请求失败时，系统按“分层”处理（高层语义，细节以实现为准）：
1) 同一 token+proxy 组合内重试（指数退避/限次）
2) 代理类错误达到阈值：切换 proxy（写入临时 override，TTL 后回切）
3) 必要时切换 token+proxy 组合（避免单 token 风控或单出口失败）

所有切换均应有可观测性：结构化日志字段 + Prometheus 指标 + 审计记录（避免 silent drift）。

## 4. 风控建议（强烈建议照做）
- 不要频繁漂移：token↔proxy 采用“主绑定 + 临时 override（TTL）”，避免频繁迁移导致风控触发。
- 代理密码与 refresh token 属于敏感信息：禁止明文日志与 API 明文返回；后台展示必须脱敏。
- 先做健康检查再放量：初次导入代理后建议先跑健康检查，确认 pximg/Pixiv API 可用。
- 生产建议启用 Admin IP allowlist、CSRF、防暴力：避免后台被扫导致配置被篡改。

## 5. 可执行示例（>= 5）

> 说明：以下示例以 Docker Compose 部署为例；如你是裸机部署，请把 `docker compose exec ...` 换成直接运行 `psql`/`curl`。

### 示例 1：预览 easy_proxies 导出的代理列表
```bash
curl -fsS http://<easy_proxies_host>:<port>/api/export | head
```

若 easy_proxies 启用了密码认证，先获取 token：
```bash
curl -fsS -X POST http://<easy_proxies_host>:<port>/api/auth -H 'Content-Type: application/json' -d '{\"password\":\"<password>\"}'
```

再带上 `Authorization: Bearer <token>` 请求 `/api/export`：
```bash
curl -fsS http://<easy_proxies_host>:<port>/api/export -H 'Authorization: Bearer <token>' | head
```

### 示例 2：在 DB 中查看导入后的 ProxyEndpoint 列表
```bash
docker compose exec -T postgres psql -U \"${POSTGRES_USER:-pixivcat}\" \"${POSTGRES_DB:-pixivcat}\" -c \"select id, scheme, host, port, enabled, source, updated_at from proxy_endpoints order by updated_at desc limit 20;\"\n```

### 示例 3：启用 fail-closed（无可用代理时直接失败）
```bash
docker compose exec -T postgres psql -U \"${POSTGRES_USER:-pixivcat}\" \"${POSTGRES_DB:-pixivcat}\" -c \"update runtime_settings set value='true', updated_at=now() where key='proxy_fail_closed';\"\n```

验证（当你暂时禁用所有代理后，访问 `/random` 应返回明确错误，而不是直连成功）：
```bash
curl -i http://127.0.0.1:3000/random\n```

### 示例 4：切回 fail-open（允许无代理直连）
```bash
docker compose exec -T postgres psql -U \"${POSTGRES_USER:-pixivcat}\" \"${POSTGRES_DB:-pixivcat}\" -c \"update runtime_settings set value='false', updated_at=now() where key='proxy_fail_closed';\"\n```

### 示例 4.1：按域名覆盖 fail-open / fail-closed
例如：全局保持 fail-open，但 pximg 图片源站必须 fail-closed（不允许直连）：
```bash
docker compose exec -T postgres psql -U \"${POSTGRES_USER:-pixivcat}\" \"${POSTGRES_DB:-pixivcat}\" -c \"insert into runtime_settings(key,value) values('proxy_fail_closed_domains','[\\\"pximg.net\\\"]') on conflict(key) do update set value=excluded.value, updated_at=now();\"\n```

例如：全局启用 fail-closed，但 OAuth 刷新允许 fail-open（仅此域名允许直连兜底）：
```bash
docker compose exec -T postgres psql -U \"${POSTGRES_USER:-pixivcat}\" \"${POSTGRES_DB:-pixivcat}\" -c \"insert into runtime_settings(key,value) values('proxy_fail_open_domains','[\\\"oauth.secure.pixiv.net\\\"]') on conflict(key) do update set value=excluded.value, updated_at=now();\"\n```

> 说明：域名列表支持子域名匹配，例如 `pximg.net` 会匹配 `i.pximg.net`。

### 示例 5：观测代理错误指标（Prometheus /metrics）
```bash
curl -fsS http://127.0.0.1:3000/metrics | rg -n \"proxy_\" -S\n```

### 示例 6：查看 token↔proxy 主绑定与临时 override（排障）
```bash
docker compose exec -T postgres psql -U \"${POSTGRES_USER:-pixivcat}\" \"${POSTGRES_DB:-pixivcat}\" -c \"select token_id, pool_id, primary_proxy_id, override_proxy_id, override_expires_at, updated_at from token_proxy_bindings order by updated_at desc limit 50;\"\n```

## 6. 常见问题（FAQ）

### Q1: 我启用了 fail-closed，但服务经常不可用？
这通常表示代理池质量不足或健康检查未收敛。建议：
- 先导入更多节点（multi-port/hybrid），并开启健康检查与黑名单；
- 检查错误分类与失败原因（连接失败/认证失败/上游限流）；
- 如需“绝不泄露真实 IP”，优先保证代理池稳定性，而不是回退到 fail-open。

### Q2: 为什么“只让 Pixiv 域名走代理”？
减少误代理风险与性能损耗。若你需要所有出站都必须走代理，请显式配置域名路由范围并启用 fail-closed。
