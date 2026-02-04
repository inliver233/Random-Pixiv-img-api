# ADR PPOOL-0002: 出站代理与代理池架构选型

- Status: Accepted
- Date: 2026-02-05
- Issue: PPOOL-0002

## Context
pixivcat-backend 现有出站请求存在“直连旁路”风险：
- Pixiv API / OAuth / pximg 原图回源等链路分散在多个模块里，缺少统一的“出站代理层”。
- legacy 图片代理 `src/controllers/imageProxyController.ts` 仍在直接 `axios.get(...)`，难以保证所有回源都按统一策略走代理/重试/观测。

本批次目标要求：
- 代理池支持 `http/https/socks4/socks5`（含认证 URI）。
- 与 `easy_proxies` “完美对接”：优先通过 `/api/export` 导入多端口节点，必要时可同步健康信息。
- 在“可用性 vs 风控（隐藏真实 IP）”之间可配置 fail-open / fail-closed。
- 代理选择需与后续的 `token↔proxy` 绑定、失败切换、可观测与热更新协同。

因此需要一个统一的架构决策：**出站请求的统一入口在哪里、代理池来源与调度怎么做、easy_proxies 的角色是什么、以及哪些范围必须纳入代理层。**

## Decision
采用“**本项目内建统一出站层 + DB 持久化代理池/策略 + easy_proxies 作为外部节点提供者**”的组合架构：

1) **统一出站入口（Single Egress Path）**
   - 引入 `OutboundHttpClient`（基于 axios 保持现有 stream 转发能力与改动最小），并在 Pixiv API / OAuth / pximg / legacy 图片代理等所有出站路径中统一使用。
   - `OutboundHttpClient` 接收 `OutboundContext`（目标域名分类 + token/proxy 选择结果 + 策略参数），内部负责：
     - 代理 Agent 注入（http/https/socks4/socks5）
     - 分层重试策略挂载
     - 统一错误分类与指标/日志字段（脱敏）

2) **代理池“本地持久化 + 调度/黑名单/健康评分”**
   - 代理端点（ProxyEndpoint）与代理池（ProxyPool）存 DB，作为运行时权威数据源。
   - 调度器只依赖本地 DB（+ 运行时缓存），支持黑名单与健康评分；不把“选择逻辑”下沉到 easy_proxies，避免耦合其内部策略与版本差异。

3) **easy_proxies 定位：节点导出/管理面（Provider），不是本项目的核心调度器**
   - easy_proxies 作为“外部节点池提供者”，通过 `/api/export` 提供稳定可复用的代理 URI 列表（多端口/混合模式）。
   - 本项目周期性或手动（AdminJS）导入/刷新，落库为 `ProxyEndpoint`（幂等）。
   - 可选：读取 `/api/nodes` 或 `/api/debug` 同步健康信息作为评分输入，但不依赖其可用性来做核心转发。

4) **域名路由边界（Only Pixiv Goes Through Proxy by Default）**
   - 默认仅 Pixiv 相关域名走代理（Pixiv OAuth、Pixiv App API、pximg 图片源站），其他域名直连（避免误代理导致不必要风险/性能损耗）。
   - 该边界通过 `RuntimeSettings` 配置可调整（例如强制所有出站都必须有代理时，切换为 fail-closed 并设置域名白名单）。

5) **fail-open / fail-closed 的可配置策略**
   - 默认 fail-open（保持现有可用性与回滚能力），同时在 UI/日志中显式标注“真实 IP 暴露风险”。
   - 若用户目标是“绝不泄露真实 IP”，可切换 fail-closed：无可用代理时直接失败（配合部署侧 egress 限制更可靠）。

## Rationale
### 为什么保留 axios（而不是重写为 undici）
- 当前链路依赖 `axios responseType=stream` → `pipe(res)` 的转发模式，重写为 undici 会扩大改动面与回归风险。
- 先通过“统一入口 + Agent 工厂 + 错误分类/重试/观测”把行为收拢，再评估替换传输栈。

### 为什么把 proxy pool 与选择逻辑留在本项目（而不是完全依赖 easy_proxies）
- 本项目需要与 token 绑定、黑名单、失败切换、审计/指标等强耦合；将选择逻辑放在本项目内更可控、更易测试。
- easy_proxies 的优势在于“多端口节点管理与导出”，适合作为 provider；但不应成为本项目核心调度器的单点依赖。

### 为什么 DB 作为运行时权威
- 热更新、审计、重启后绑定与黑名单恢复都需要持久化。
- 仅靠 env 无法满足多 token、多 proxy 与运行时管理要求。

## Consequences
- 需要对现有出站调用做“统一入口”重构（逐步替换，不一次性大爆炸）。
- 需要新增 Prisma 模型：`ProxyEndpoint` / `ProxyPool` / `RuntimeSettings` 等。
- 必须补齐契约/集成测试以防 legacy 与 `/random` 行为回归。

## Alternatives Considered
- **完全自建代理池（不依赖 easy_proxies）**：需要自建订阅/节点刷新/健康管理，成本更高且与“完美对接 easy_proxies”目标冲突。
- **完全依赖 easy_proxies 做调度**：本项目难以实现 token↔proxy 稳定绑定、审计与最小迁移等核心需求；测试也更困难。
- **全面切换 undici**：长期可取，但本批次回归风险过高，优先收敛出站入口与策略层。

## References
- `src/http/axiosClient.ts`
- `src/controllers/imageProxyController.ts`
- `docs/usage/easy-proxies-integration.md`（后续）
- `issues/2026-02-05_01-07-40-proxy-pool-token-binding-hot-reload.csv`（PPOOL-0002）

