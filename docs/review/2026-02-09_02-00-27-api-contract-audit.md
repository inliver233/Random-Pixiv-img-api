# API 合约与参数矩阵审计（/random + 分类检索 + healthz/metrics + legacy）

- 审计时间：2026-02-09_02-00-27（本机时间）
- 目标站点：https://i.mukyu.ru
- 覆盖策略：按 README 与 docs/api/* 契约做参数矩阵/异常态验证；检查错误包结构、缓存头、重定向语义一致性
- 证据目录：
  - Network（脱敏摘要）：docs/review/network/2026-02-09_02-00-27/

> 安全硬规则：本文档与所有落盘证据不得包含任何完整凭据（token/password/refresh_token/代理密码/cookie/Authorization）。如需引用仅允许掩码。

---

## 0. 审计基线摘要

已阅读并对齐：
- E:/pixiv-download-修改版本/最初计划.txt
- pixiv-反代/pixivcat-backend/随机api开发规划.md
- pixiv-反代/pixivcat-backend/README.md、pixiv-反代/pixivcat-backend/docs/api/random.md、pixiv-反代/pixivcat-backend/docs/api/classification.md、pixiv-反代/pixivcat-backend/docs/errors.md
- 关键实现：app.ts、src/routes/random.ts、src/routes/images.ts、src/routes/tags.ts、src/routes/authors.ts、src/routes/healthz.ts、src/routes/metrics.ts、legacy 路由

---

## 1. 本轮重点复核（Top 高危 D）

### 1.1 D) API 契约高危：min_* 超 int4 上限触发 500（应 400）
- 复现步骤（真实站点）：
  1) 请求：`GET https://i.mukyu.ru/random?format=json&min_width=2147483648`
  2) 观察返回：`500`，错误包 `code=P2020`（不符合契约，期望 400）
  3) 请求：`GET https://i.mukyu.ru/images?limit=1&min_width=2147483648`
  4) 观察返回：`500`，错误包 `code=P2020`（同类问题）
- 关键 network 摘要（脱敏）：
  - `docs/review/network/2026-02-09_02-00-27/api-D1-random-min_width-int4over.summary.txt`
  - `docs/review/network/2026-02-09_02-00-27/api-D2-images-min_width-int4over.summary.txt`
- 代码定位（本仓库对照）：
  - 输入层缺少 int4 上限校验：
    - `src/routes/random.ts:159`
    - `src/routes/images.ts:155`
  - 查询层溢出/类型不匹配风险点（需配合修复，避免乘法溢出/DB 强制转换异常）：
    - `src/repositories/imagesRepo.ts:260`
    - `src/repositories/imagesRepo.ts:426`
- root cause 结论：
  - 当前 `min_width/min_height/min_pixels` 仅做“非负整数/safeInteger”等校验，未限制到数据库字段可承载范围（int4），导致 Prisma/SQL 层抛错并被统一映射成 500。
  - 修复策略必须在**入口**完成：对 `min_*` 增加 `<= 2147483647` 校验（或明确 clamp 策略），超界直接返回结构化 `400 BAD_REQUEST`；同时对 raw SQL 分支使用 `::bigint` cast（尤其是 `width * height`）避免乘法溢出。

---

## 2. 参数矩阵（待执行）

- /random：binary/json/redirect + r18/orientation/min_*/tags/user_id/illust_id/attempts/seed
- /tags /authors /images：limit/cursor + 筛选参数一致性 + 400 校验
- /healthz /metrics：可观测与安全配置
- legacy：稳定性与限流语义

---

## 3. 发现的问题（待追加）

（按 High/Medium/Low 追加；每条必须包含：复现步骤、network 摘要、证据路径、代码定位、期望vs实际、修复建议。）
