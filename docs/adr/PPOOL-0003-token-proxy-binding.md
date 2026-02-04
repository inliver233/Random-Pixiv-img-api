# ADR PPOOL-0003: Token↔Proxy 绑定与迁移策略

- Status: Accepted
- Date: 2026-02-05
- Issue: PPOOL-0003

## Context
本批次需要同时降低两类风险：
- token 配额与风控：多 token 轮换与限速（已有基础）需要继续保留并增强；
- IP 风控：出站请求需要通过代理池分散出口，并且 **token↔proxy 尽量稳定绑定**，避免频繁漂移导致风控触发。

约束与场景：
- tokens 与 proxies 数量可能不相等（tokens>proxies 或 proxies>tokens）。
- 代理端点可能动态增删、健康状态波动；失败时需要“切换组合”保证可用性。
- 绑定必须持久化，重启后保持一致；但也需要支持临时 override（失败后短期切换、可回切）。

因此需要一个策略，兼顾：
- **稳定性**：少迁移、少漂移；
- **可用性**：失败可切换；
- **可解释性与可操作性**：能在后台查看/手动 rebind；
- **可测试**：算法可单测验证“最小迁移”。

## Decision
采用“**持久化主绑定 + 临时 override（TTL）+ 绑定计算使用 Rendezvous Hash（HRW）作为兜底**”的组合策略。

### 1) 绑定的两层语义
- **Primary binding（主绑定）**：持久化的默认 token→proxy 指派，目标是“最小迁移/稳定”，除非：
  - 主 proxy 被移除/禁用；
  - 主 proxy 持续不健康（达到阈值）且触发重建；
  - 管理员手动 rebind。
- **Override binding（临时切换）**：当某 token 在某 proxy 上出现可归因的代理类失败时，写入临时 override（含 TTL 与 reason），在 TTL 内优先使用 override；TTL 到期自动回切到 primary（若 primary 仍有效）。

### 2) 主绑定的生成规则（最小迁移）
当某 token 没有主绑定（或其主 proxy 不再可用）时，按以下顺序选择：
1. 候选集：同一 pool 内“启用且健康评分达标”的 proxies（可配置阈值；无健康数据时允许全部启用 proxies）。
2. 选择算法：使用 **Rendezvous Hash（Highest Random Weight, HRW）**，对每个候选 proxy 计算分数，取分数最高者作为主绑定。

HRW 的特点：当 proxies 集合增删时，只有少量 token 会迁移到新/替代 proxy，符合“最小迁移”的目标；并且不依赖列表顺序（避免排序变化导致漂移）。

### 3) tokens 与 proxies 数量不等量时的策略
- **tokens > proxies**：允许多个 token 映射到同一 proxy；HRW 会在整体上趋向分散（但不保证严格均匀）。
- **proxies > tokens**：允许存在未被任何 token 使用的 proxy；这比“强行均匀使用所有 proxy”更稳定，且符合“少迁移”原则。

如需更均匀（例如希望尽量用满出口），通过“后台手动 rebind / 批量 rebind”实现，而不是在运行时自动频繁迁移。

### 4) 临时 override 的触发与回切
- 触发条件：在同一 token+proxy 组合内发生“代理类错误”（连接失败、握手失败、隧道失败、超时、认证失败等）达到阈值。
- 行为：从候选 proxies 中选择一个替代 proxy（同样可用 HRW，但排除当前坏 proxy；或基于健康评分优先），写入 override + `expiresAt`（例如 10~30 分钟，可配置）。
- 回切：到期后自动回到 primary；若 primary 不可用则重建 primary。

### 5) 持久化模型（概念）
绑定表需要表达以下字段（细节以 Prisma 为准）：
- `tokenId`
- `poolId`
- `primaryProxyId`
- `overrideProxyId`（可空）
- `overrideExpiresAt`（可空）
- `updatedAt` / `createdAt`
- `reason` / `lastErrorCode`（可选，用于审计与可观测）

## Pseudocode

### HRW Score
```
score(tokenId, proxyId) = hash64(poolId + ":" + tokenId + ":" + proxyId)
pickPrimary(tokenId, proxies) = argmax_proxy score(tokenId, proxyId)
```

### Select proxy for token
```
selectProxy(tokenId):
  binding = loadBinding(tokenId, poolId)
  if binding.overrideProxyId and now < binding.overrideExpiresAt:
    return binding.overrideProxyId
  if binding.primaryProxyId is available:
    return binding.primaryProxyId
  primary = pickPrimary(tokenId, availableProxies())
  persistPrimary(tokenId, primary)
  return primary
```

### Failover (temporary override)
```
onProxyFailure(tokenId, failedProxyId, error):
  if not isProxyClassError(error): return
  if not thresholdReached(tokenId, failedProxyId): return
  candidateProxies = availableProxies(exclude=failedProxyId)
  override = pickPrimary(tokenId, candidateProxies)  # HRW as deterministic fallback
  persistOverride(tokenId, override, ttlMinutes, reason=error.code)
```

## Examples (Intuition)
假设 token: `T1..T5`，proxy: `P1,P2`：
- 初始：HRW 会把 `T1..T5` 分散到 `P1/P2`（允许多个 token 命中同一 proxy）。
- 新增 `P3`：只有一部分 token 会迁移到 `P3`；其余 token 保持原映射（最小迁移）。
- 移除 `P1`：原本绑定到 `P1` 的 token 需要重建 primary；绑定到 `P2/P3` 的 token 不变。

失败场景：
- `T2` 在 `P2` 连续代理握手失败：写入 override 指向 `P3`（TTL 20 分钟），TTL 内 `T2` 出站使用 `P3`；
- TTL 到期且 `P2` 恢复健康：回切到 primary（仍为 `P2`），避免长期漂移。

## Consequences
- 需要实现错误分类与“代理类错误阈值”统计（支撑 override 触发）。
- 需要在 AdminJS 提供可视化与手动 rebind（必要时批量）能力。
- 需要单测验证：固定 seed 下映射稳定；增删 proxy 时迁移量合理；override 语义正确。

## Alternatives Considered
- `tokenIndex % proxyCount`：实现简单，但当 proxyCount 变化时迁移量很大，不满足“最小迁移”。
- 一律动态选择“当前最优 proxy”（根据延迟/成功率）：会造成频繁漂移，与风控目标冲突。
- 完全不持久化、仅靠 hash：虽然 deterministic，但无法表达 override TTL、手动 rebind 与审计等需求。

## References
- `src/services/pixivAuthService.ts`
- `docs/adr/PPOOL-0002-outbound-proxy-architecture.md`
- Issue CSV: `PPOOL-0003`

