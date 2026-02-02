# Admin

本项目的后台入口为 `/admin`（AdminJS + 少量自定义管理接口）。

## 鉴权（ADMIN_TOKEN）
`/admin` 默认使用 `ADMIN_TOKEN` 做 Bearer Token 鉴权：
- Header：`Authorization: Bearer <ADMIN_TOKEN>`
- 或 URL：`/admin?token=<ADMIN_TOKEN>`（首次访问会写入 `admin_token` cookie 并重定向到无 token 的 URL）

## IP 访问控制（ADMIN_IP_ALLOWLIST，可选）
可选启用 `ADMIN_IP_ALLOWLIST`，仅允许指定 IP / IPv4 CIDR 段访问 `/admin`。

### 配置格式
- 允许分隔符：逗号 `,` / 空格 / `|`
- 支持：
  - 单个 IP：`127.0.0.1`、`::1`
  - IPv4 CIDR：`10.0.0.0/8`、`192.168.0.0/16`、`172.16.0.0/12`

示例（仅本机访问）：
```bash
ADMIN_IP_ALLOWLIST=127.0.0.1,::1
```

示例（仅内网访问）：
```bash
ADMIN_IP_ALLOWLIST=10.0.0.0/8,192.168.0.0/16,172.16.0.0/12
```

### 行为
- 未设置 `ADMIN_IP_ALLOWLIST`：不启用 IP 限制（保持现有行为）。
- 设置了 `ADMIN_IP_ALLOWLIST` 但格式非法：返回 `503`（`code=ADMIN_IP_ALLOWLIST_INVALID`）。
- 客户端 IP 不在 allowlist 内：返回 `403`（`code=ADMIN_IP_DENIED`）。

### 获取客户端 IP 的规则
- 默认使用 Express 的 `req.ip`。
- 当 Express 启用 `trust proxy` 时，将使用 `req.ips[0]`（来自代理链的第一个 IP）。

## 手动验收步骤
1) 设置：
   - `ADMIN_TOKEN=test_admin_token`
   - `ADMIN_IP_ALLOWLIST=127.0.0.1,::1`
2) 访问（应通过）：
   - `curl -i -H "Authorization: Bearer test_admin_token" http://127.0.0.1:3000/admin`
3) 改为不包含本机的 allowlist（应拒绝）：
   - `ADMIN_IP_ALLOWLIST=10.0.0.0/8`
   - 重启服务后：`curl -i -H "Authorization: Bearer test_admin_token" http://127.0.0.1:3000/admin` 返回 403

