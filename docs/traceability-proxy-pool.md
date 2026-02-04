# 需求可追溯矩阵：Proxy Pool / Token 绑定 / 热更新（PPOOL）

目的：把用户需求（1~8）映射到本批次 Issue CSV（`issues/2026-02-05_01-07-40-proxy-pool-token-binding-hot-reload.csv`）中的 Issue ID，确保交付范围可追溯且不漏项。

## Matrix

| 需求 | 需求摘要 | 对应 Issue（至少 1 条） | 备注 |
| --- | --- | --- | --- |
| 1 | 代理池支持 http/https/socks4/socks5（含认证 URI），并可对接 easy_proxies（优先 `/api/export`） | `PPOOL-0201` `PPOOL-0202` `PPOOL-0203` `PPOOL-0204` `PPOOL-0205` `PPOOL-0206` `PPOOL-0207` `PPOOL-0505` `PPOOL-0007` | 覆盖 URI 解析、Agent 工厂、域名路由、调度/黑名单、健康检查、easy_proxies 导入与健康映射、后台一键导入。 |
| 2 | 多 token 多 IP 稳定绑定（少迁移/不漂移），考虑 tokens≠proxies 场景且绑定持久化 | `PPOOL-0003` `PPOOL-0101` `PPOOL-0103` `PPOOL-0301` `PPOOL-0304` `PPOOL-0305` `PPOOL-0306` `PPOOL-0303` | 覆盖 DB 持久化、主绑定与最小迁移、冲突策略、临时 override 与回切、token 选择策略与热更新。 |
| 3 | 失败重试与切换（代理失败重试 N 次→切换 proxy→必要时切换 token+proxy），并具备可观测性与审计 | `PPOOL-0401` `PPOOL-0402` `PPOOL-0403` `PPOOL-0404` `PPOOL-0208` `PPOOL-0108` | 覆盖错误分类、分层重试/退避、切换策略、指标与脱敏日志、配置变更审计。 |
| 4 | 热更新：token/代理池/策略可在 AdminJS 增删改查并立即生效；env 兜底，DB 为运行时权威；不依赖 compose 重启 | `PPOOL-0004` `PPOOL-0104` `PPOOL-0506` `PPOOL-0501` `PPOOL-0502` `PPOOL-0503` `PPOOL-0504` `PPOOL-0507` `PPOOL-0508` | 覆盖配置优先级、运行时热更新机制、多实例同步可选增强、管理端权限与敏感信息保护。 |
| 5 | 数据持久化：图片/URL/元信息/tags 结构清晰合理（schema+索引审计+迁移 runbook） | `PPOOL-0101` `PPOOL-0102` `PPOOL-0103` `PPOOL-0104` `PPOOL-0105` `PPOOL-0106` `PPOOL-0107` | 覆盖 token/proxy/binding/settings/hydration 持久化与索引约束审计、迁移与回滚说明。 |
| 6 | 元信息补全可控：导入后可选是否补全；支持 backfill；可暂停/继续/取消；重启可续跑；也支持“请求顺便补全”（异步可开关限速） | `PPOOL-0105` `PPOOL-0601` `PPOOL-0602` `PPOOL-0603` `PPOOL-0604` `PPOOL-0605` `PPOOL-0606` `PPOOL-0607` | 覆盖补全策略开关、手动触发、批量补全与进度持久化、暂停/恢复/取消、opportunistic hydrate、作业使用 token+proxy 绑定与排障面板。 |
| 7 | UI/UX：后台信息架构优化；组件库/风格方案先 ADR 决策，再落地；避免无序引入 | `PPOOL-0005` `PPOOL-0801` `PPOOL-0802` `PPOOL-0504` `PPOOL-0607` | 覆盖 UI 技术栈 ADR、导航分组与信息架构、样式/交互规范、关键观测面板与排障入口。 |
| 8 | 分类/请求格式正确：按分类请求、多 format（image/json/redirect）稳定正确；补齐契约测试，确保老功能可用 | `PPOOL-0701` `PPOOL-0702` `PPOOL-0703` `PPOOL-0704` `PPOOL-0705` `PPOOL-0805` | 覆盖 API 契约设计、分类查询接口、/random 与 legacy 路由契约测试、OpenAPI/使用文档同步、批次回归与 smoke。 |

## 非功能与安全约束（跨需求）
- 管理安全与敏感信息：`PPOOL-0508`（配合 `PPOOL-0108` 审计）。
- 安全默认值与开放面控制：`PPOOL-0210`（与 `PPOOL-0006` 使用指南、`PPOOL-0407` fail-open/closed 策略对应）。
- 代码结构可扩展性与双份源码治理：`PPOOL-0803` `PPOOL-0804`（降低后续维护风险）。

