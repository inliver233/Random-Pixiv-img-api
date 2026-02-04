# ADR PPOOL-0004: 热更新数据源与多实例同步

- Status: Accepted
- Date: 2026-02-05
- Issue: PPOOL-0004

## Context
本批次需要实现“无需重启的热更新”：
- token / proxy / 策略开关可在 AdminJS 增删改查并立即生效；
- env 作为默认兜底，但 **DB 为运行时权威**；
- 支持后续多实例部署时的配置同步（可选增强）。

现状约束：
- `src/config/env.ts` 的 `getEnv()` 使用进程内缓存（`cachedEnv`），属于“启动期静态配置”；不能依赖修改 env 达到热更新。
- 部分配置（DB、memcached、Admin token 等）是启动必需项；热更新不应破坏这些强约束。

因此需要明确：
- 哪些配置来自 env、哪些来自 DB；
- 配置优先级与回退；
- 本地热更新机制与可选的多实例同步方案；
- 一致性边界（做到“近实时”，而非强一致分布式配置中心）。

## Decision
采用“**env 启动配置 + DB RuntimeSettings 运行时配置 + 进程内缓存可失效 + 可选 LISTEN/NOTIFY 同步**”的方案。

### 1) 配置分层与优先级
1. **Env（启动配置）**：由 `getEnv()` 解析并缓存，包含：
   - 必需的基础依赖（DB/memcached/端口等）
   - 默认策略参数（作为 RuntimeSettings 的缺省值来源）
2. **RuntimeSettings（运行时配置，DB 权威）**：
   - 只承载“允许热更新”的策略开关与参数（例如 fail_closed、重试次数、域名路由开关、限速阈值等）。
   - 读取时形成 **effective runtime config**：
     - `effective[key] = dbValue ?? envDefault`

明确边界：env 仍然决定“是否能启动”和基础依赖；RuntimeSettings 决定“运行时策略如何工作”。

### 2) 热更新在单实例的实现语义
引入 `RuntimeConfigService`（概念），提供：
- `getEffectiveConfig()`：返回缓存中的 effective config
- `invalidate()`：立即使缓存失效（下次读取将从 DB 重新加载）
- `getVersion()`：可选，用于观测/调试当前配置版本

AdminJS 修改 RuntimeSettings 后：
- 写入 DB（含 `updatedAt` / `version` 自增）
- 在同进程内调用 `invalidate()`，实现“立即生效”

若某些调用路径不在同进程触发（例如后台 job/worker），仍可通过短 TTL（例如 1~5 秒）保证“近实时”更新。

### 3) 多实例同步（可选增强）
当部署为多实例时，单进程内 `invalidate()` 不够，需要跨实例传播。采用可选的 PostgreSQL `LISTEN/NOTIFY`：
- 每次 RuntimeSettings 或关键资源（token/proxy/pool）变更后，发送 `NOTIFY pixivcat_config_changed, '<scope>'`
- 每个实例启动时 `LISTEN pixivcat_config_changed`，收到通知后执行：
  - `RuntimeConfigService.invalidate()`
  - （可选）TokenStore/ProxyPool 缓存 invalidate

一致性边界：
- 不追求强一致；以“秒级传播”满足运维可用性。
- NOTIFY 失败时由 TTL 兜底（最终一致）。

### 4) 回退策略（DB 不可用时）
- 读取 RuntimeSettings 失败（例如 DB 暂时不可用）：
  - 继续使用最近一次成功加载的缓存（如果存在）
  - 若无缓存（冷启动）则回退到 env 默认值（fail-open 优先，避免启动即不可用）
- 将回退行为暴露为指标/日志字段（避免“静默降级”）

## Rationale
- `getEnv()` 缓存是合理的：启动配置应当稳定，避免每次读取解析/校验带来开销与不确定性。
- 热更新需要独立的数据源与缓存失效机制：DB 更适合做运行时权威并提供审计与持久化。
- LISTEN/NOTIFY 能复用 PostgreSQL，避免再引入配置中心；同时可用 TTL 作为容错兜底。

## Consequences
- 需要新增 `RuntimeSettings` 模型与读写 API（AdminJS）以及审计记录。
- 需要为关键缓存（tokens/proxies/bindings/settings）提供明确的 invalidation 入口。
- 多实例同步为可选开关：不开启时仍需提供 TTL 兜底，保证行为可预测。

## Alternatives Considered
- 直接改 env + 重启：不满足“无需 compose 重启”的目标。
- 依赖 memcached 做配置中心：可行但缺少事务/审计与 schema 约束，且与 pg-boss/Prisma 的 DB 权威方向不一致。
- 引入外部配置中心（Consul/etcd）：过重，不符合本批次“先单体可用”的范围。

## References
- `src/config/env.ts`（`getEnv()` 缓存）
- Issue CSV: `PPOOL-0004`

