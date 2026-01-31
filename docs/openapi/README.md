# OpenAPI

入口文件：`docs/openapi/openapi.yaml`

## 目标
- 作为接口契约的单一来源：参数、响应 schema、错误码、关键响应头（Cache-Control/Location/Retry-After 等）
- 与仓库真实路由结构保持一致（新增/变更路由时必须同步更新）

## 校验建议（可选）

本仓库会在后续 Issues 中补齐 OpenAPI lint/validate 的一键命令；在此之前可使用以下任一方式：

### 方案 A：Redocly CLI
```bash
npx @redocly/cli lint docs/openapi/openapi.yaml
```

### 方案 B：swagger-cli
```bash
npx swagger-cli validate docs/openapi/openapi.yaml
```

