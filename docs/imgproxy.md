# imgproxy（可选）：签名 URL（仅 /random JSON 返回）

本项目支持 **可选** 集成 imgproxy：当配置了 `IMGPROXY_*` 环境变量时，`GET /random?format=json` 会额外返回一个签名后的 imgproxy URL（防滥用）。

## 为什么必须签名（DoS 风险）

imgproxy 是一个通用的图片处理代理。如果你把 imgproxy 暴露到公网且允许 “insecure/unsafe”，任何人都可以拿它当公共代理：
- 大量请求导致 CPU/带宽/出网成本失控
- 被当作 SSRF/代理跳板（取决于 imgproxy 配置）

因此：**本项目只输出签名 URL**，并且需要你在 imgproxy 侧也关闭 insecure/unsafe。

## 环境变量

需要同时配置以下三个变量（缺一会被 env 校验拒绝启动）：
- `IMGPROXY_URL`：imgproxy 的公网/内网访问地址（例如 `https://imgproxy.example.com`）
- `IMGPROXY_KEY`：imgproxy 签名 key（hex 字符串，偶数长度）
- `IMGPROXY_SALT`：imgproxy 签名 salt（hex 字符串，偶数长度）

> `IMGPROXY_KEY/IMGPROXY_SALT` 的 hex 编码方式与 imgproxy 官方 “signing the URL” 一致。

## /random JSON 字段

当启用 imgproxy 时：
- `urls.proxy`：稳定代理 URL（本服务）
- `urls.origin`：Pixiv 原图 URL（DB 中保存）
- `urls.imgproxy`：签名后的 imgproxy URL（仅当配置了 `IMGPROXY_*` 时出现）

当前实现会为 `urls.imgproxy` 使用固定处理参数 `raw:1`，并对 `urls.origin` 进行 base64url 编码后拼接到 imgproxy URL。

## 验证

本仓库包含单元测试用例（签名向量来自 imgproxy 官方文档）：

```bash
npm test
```

