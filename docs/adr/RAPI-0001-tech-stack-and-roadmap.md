# ADR RAPI-0001: 锁定目标技术栈与路线图

- Status: Accepted
- Date: 2026-01-31
- Issue: RAPI-0001

## Context
本仓库当前是一个 Node/Express 图片代理服务，具备：
- Pixivcat 兼容路由（`/:illustId.:ext`、`/:illustId-:page.:ext`）
- 上游图片“流式转发”（`axios responseType=stream` → `pipe(res)`），不可改为读入内存
- 基于 Pixiv API 的 illust detail 拉取 + memcached 缓存 + refresh token 轮换

目标是在 **不破坏现有兼容路由** 的前提下，升级为「随机二次元图片 API」：
- 新增 `/random`（默认图片流；`format=json` 返回 JSON；`redirect=1` 返回 302 到稳定图片 URL）
- 支持强筛选（r18、orientation、尺寸、tags、user_id、illust_id、seed、attempts 等）
- 管理后台（不停机导入/启用/禁用/删除、统计）
- 稳健性（失败换图重试、broken 冷却、自愈 original_url 冷路径修复）
- 可观测（结构化日志、request_id、Prometheus `/metrics`）
- 工程化（TypeScript 增量迁移、Prisma+PostgreSQL、pg-boss 队列、Vitest/supertest、Docker/Compose、CI）

这些需求决定：必须引入可扩展的数据层、可回滚的迁移、可观测体系，以及可复用的测试骨架。

## Decision
锁定以下技术栈与实施顺序（后续 Issues 默认以此为前提，不再重复讨论）：

### Runtime / Web
- Node.js: `>=24`
- Web framework: Express `v5`

### Data
- Database: PostgreSQL
- ORM / Migration: Prisma

### Admin
- 后台：AdminJS（MVP 快速落地 CRUD + 导入 + 统计；后续可替换/扩展）

### Jobs / Queue
- 任务队列：pg-boss（基于 PostgreSQL，减少额外依赖；用于 heal_url / hydrate_metadata 等冷路径任务）

### Validation / Observability / Metrics
- 配置与 schema 校验：zod（env/schema）
- 结构化日志：pino（统一字段 + request_id；敏感信息脱敏）
- 指标：prom-client（暴露 `/metrics`，便于 Prometheus 抓取）

### Testing
- Vitest + supertest：单元/集成测试主干；保障 legacy 兼容路由与新 `/random` 语义不回归

### Image transform（可选）
- imgproxy：**不是 MVP 强制项**；若启用，必须使用签名 URL（防滥用与成本失控）

### Roadmap（执行顺序）
1) Foundation + MVP：TS 构建链、测试骨架、DB/Prisma、最小导入与后台、`/random` 基础能力、保持 legacy 路由不回归
2) Metadata & 强筛选：冷路径补全 Pixiv 元信息、标签/作者筛选、筛选语义稳定化、JSON 响应标准化
3) 工程化 & 运维：可观测增强、随机算法降级（如 TABLESAMPLE）、部署与安全加固、CI/Compose 体系化

## Rationale
### 为什么 PostgreSQL + Prisma（而不是 SQLite）
- 随机选取与强筛选需要可控的索引策略与并发能力；PostgreSQL 更适合作为长期存储与可观测能力的底座（队列也复用 DB）
- Prisma 提供跨环境一致的 schema/migration/workflow，便于在 CI 与 Docker/Compose 中复现
- SQLite 可用于原型验证，但会把后续迁移/并发/随机性能问题推迟到“更难改”的阶段

### 为什么 pg-boss（而不是 Redis + BullMQ）
- 本项目已经强依赖 Pixiv 上游与网络，进一步引入 Redis 会增加部署与运维复杂度
- pg-boss 复用 PostgreSQL，减少组件数量；适合冷路径任务（heal/hydrate/审计/定时清理）
- BullMQ 在高吞吐/多 worker 场景很强，但对本项目 MVP 来说依赖更重，且需要额外的 Redis

### 为什么 AdminJS（而不是从第一天自研后台）
- “不停机热更新 + CRUD + 审计/统计”的需求明确，AdminJS 能最快把管理能力落地，降低前期开发成本
- 自研后台可以作为后续阶段，用于更好的 UX/权限/审计视图；但不应阻塞 API 主链路交付

### 为什么 Express 5（而不是 Fastify）
- 仓库现有代码与路由模式已基于 Express；迁移到 Fastify 属于非必要的框架级重构，回归风险更高
- Express 5 足以承载本项目需求；通过中间件与模块拆分保持可维护性即可

### 为什么 TypeScript（增量迁移，而不是全量重写）
- 目标是“保持 legacy 不回归 + 分阶段交付新能力”，增量迁移可以控制风险并持续交付
- TS 在 DB schema、过滤参数、队列 payload、错误码与日志字段等边界处能显著降低回归

## Consequences
- 需要引入 PostgreSQL（开发与 CI 需 Compose / 迁移流程）
- 项目将进入 TS/JS 混合期（短期增加构建复杂度，但换取长期可维护）
- 部署形态以单体服务为主：API + Admin + Jobs 共享同一 DB（按需拆 worker）
- imgproxy 若启用必须签名；未启用时 JSON 中只返回原图或稳定代理 URL

## Alternatives Considered
- SQLite：原型快，但并发、迁移、随机性能与扩展性不足；不作为默认方案
- Redis + BullMQ：成熟强大，但引入额外组件；本项目优先减少依赖
- 自研后台：最终可做，但 MVP 阶段先用 AdminJS
- Fastify：性能与类型体验好，但迁移成本与回归风险过高
- 继续纯 JS：短期快，但随着筛选/队列/观测/错误码复杂度上升，风险更大

## References
- `plan/2026-01-31_19-36-13-random-anime-image-api.md`
- `issues/2026-01-31_19-36-13-random-anime-image-api.csv`（RAPI-0001）
- `随机api开发规划.md#13`

