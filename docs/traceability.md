# 需求可追溯矩阵（Requirements → Issues）

目的：把 `随机api开发规划.md` 的 **0~11** 关键点映射到本仓库的 Issue CSV（执行边界），用于：
- 确保需求不漏项
- 需求变更时快速定位需要调整的 Issue

规则：
- 本矩阵的“状态源”是 `issues/2026-01-31_19-36-13-random-anime-image-api.csv`
- 若 `随机api开发规划.md` 发生新增/变更：必须同步更新本文件，并在 Issue CSV 中新增/调整对应 Issue

## Matrix

| 规划章节 | 关键点摘要 | 关联 Issue（至少 1 条） |
| --- | --- | --- |
| `#0 你的需求` | 随机图片（image/json/redirect）、强筛选、后台热更新、稳健性、统计与工程化 | RAPI-0052, RAPI-0054, RAPI-0056, RAPI-0062, RAPI-0070, RAPI-0084, RAPI-0092, RAPI-0044, RAPI-0007 |
| `#1 现有项目审计` | 保留现有 pixivcat 兼容路由、流式代理与头部策略；修复已知薄弱点（上游错误/缓存/安全） | RAPI-0018, RAPI-0022, RAPI-0157, RAPI-0159, RAPI-0168 |
| `#2 升级方向总纲` | 把 Pixiv API 从热路径移走；推荐 redirect=1 走稳定 URL；legacy 路由优先走 DB | RAPI-0048, RAPI-0051, RAPI-0118, RAPI-0170 |
| `#3 对标调研` | 参考 waifu.im 接口语义、imgproxy（必须签名）、稳健性组件与随机性能方案 | RAPI-0005, RAPI-0040, RAPI-0112, RAPI-0171 |
| `#4 架构设计` | 单体优先、模块化拆分（routes/services/repos/jobs/metrics）；冷路径任务化；可观测贯穿 | RAPI-0001, RAPI-0033, RAPI-0041, RAPI-0094, RAPI-0020 |
| `#5 数据库设计` | images/tags/image_tags/imports schema；random_key 两段随机；失败冷却；必要索引与降级方案 | RAPI-0027, RAPI-0029, RAPI-0030, RAPI-0031, RAPI-0032, RAPI-0037, RAPI-0038, RAPI-0039, RAPI-0155, RAPI-0156 |
| `#6 API 设计` | `/random,/images,/i,/healthz,/metrics,/admin`；参数/错误码/缓存头契约；兼容路由说明 | RAPI-0004, RAPI-0005, RAPI-0021, RAPI-0041, RAPI-0042, RAPI-0044, RAPI-0046, RAPI-0048, RAPI-0052 |
| `#7 伪代码/核心逻辑` | Pixiv URL 解析；导入（upsert+审计+入队）；/random attempts；自愈 heal_url / hydrate_metadata | RAPI-0090, RAPI-0092, RAPI-0058, RAPI-0095, RAPI-0097 |
| `#8 管理后台` | AdminJS MVP；ADMIN_TOKEN 鉴权；导入/启用/禁用/软删；统计面板；审计与加固选项 | RAPI-0082, RAPI-0084, RAPI-0085, RAPI-0086, RAPI-0087, RAPI-0089, RAPI-0111, RAPI-0206 |
| `#9 稳健性与性能` | 网络重试/熔断/限流；/metrics；随机算法与基线压测；错误码与日志关联 | RAPI-0101, RAPI-0102, RAPI-0099, RAPI-0044, RAPI-0197, RAPI-0216, RAPI-0218 |
| `#10 迭代路线图` | 分阶段交付（基础工程→MVP→强筛选→工程化）；Docker/Compose/CI 保障可复现交付 | RAPI-0006, RAPI-0007, RAPI-0009, RAPI-0024, RAPI-0025, RAPI-0026, RAPI-0113 |
| `#11 风险与合规` | 默认全年龄（r18=0）；下架/审计与安全；secrets 不进镜像/不进日志；合规说明文档 | RAPI-0110, RAPI-0111, RAPI-0172, RAPI-0211, RAPI-0217 |

