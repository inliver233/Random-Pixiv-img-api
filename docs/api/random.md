# /random

`GET /random` 默认返回图片流（binary），并强制 `Cache-Control: no-store`。

## `format`

`format` 控制响应格式：

- `format=image`（默认）：返回图片流（`Content-Type` 取决于图片）。
- `format=json`：返回 JSON，包含图片元信息与可用 URL。

### 示例

默认图片流：

```bash
curl -i "http://127.0.0.1:3000/random" -o out.bin
```

JSON：

```bash
curl -s "http://127.0.0.1:3000/random?format=json"
```

### 常见坑

- 仅设置 `Accept: application/json` 不会把成功响应变成 JSON；必须用 `format=json`。
- 当 `redirect=1` 时会优先 302 跳转到稳定 URL，`format` 会被忽略。
- 非法值（如 `format=xml`）会返回 400（`code=BAD_REQUEST`, `message=Invalid format.`）。

## `redirect`

`redirect` 控制是否返回 302 重定向到稳定图片 URL（`/i/:id.:ext`）：

- `redirect=0`（默认）：不重定向，按 `format` 返回图片流或 JSON。
- `redirect=1`：返回 302，响应头 `Location` 指向稳定图片 URL。

### 示例

只拿到 302 + Location：

```bash
curl -i "http://127.0.0.1:3000/random?redirect=1"
```

跟随重定向并下载图片：

```bash
curl -L "http://127.0.0.1:3000/random?redirect=1" -o out.bin
```

### 常见坑

- `redirect=1` 会优先于 `format`（即使 `format=json` 也会返回 302）。

## `attempts`

`attempts` 用于控制随机挑选失败时的重试次数：

- 默认 `3`
- 仅接受整数；非整数将返回 400（`code=BAD_REQUEST`, `message=Invalid attempts.`）
- 会被夹到 `[1, 10]`（例如 `attempts=999` 实际按 `10` 处理）

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?attempts=1"
curl -i "http://127.0.0.1:3000/random?attempts=10"
```

### 常见坑

- `attempts` 越大，对数据库/上游压力越大；除非需要更强的“命中保证”，否则保持默认即可。
