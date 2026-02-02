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

## `seed`

`seed` 用于固定随机序列（可复现同一批结果，便于调试/缓存）：

- 不传：使用真正随机（`Math.random()`）
- 传入：相同 `seed` 在同一版本下会得到可复现的结果序列

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?seed=demo"
```

### 常见坑

- `seed` 不能是空字符串/纯空白，否则会返回 400（`code=BAD_REQUEST`, `message=Invalid seed.`）。

## `r18`

`r18` 用于筛选 Pixiv 的分级（对应 `xRestrict`）：

- `r18=0`（默认）：全年龄
- `r18=1`：R18
- `r18=2`：R18G

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?r18=0"
curl -i "http://127.0.0.1:3000/random?r18=1"
```

### 注意事项

- `r18` 仅支持 `0/1/2`；空值或其他值会返回 400（`message=Invalid r18.`）。
- `r18` 越严格，可用候选越少；若出现频繁 `NO_MATCH`，可考虑减少其他过滤条件或提高 `attempts`。

## `orientation`

`orientation` 用于筛选图片方向：

- `any`（默认）：不筛选
- `portrait`：竖图
- `landscape`：横图
- `square`：正方形

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?orientation=portrait"
curl -i "http://127.0.0.1:3000/random?orientation=landscape"
```

### 注意事项

- `orientation` 仅支持 `portrait/landscape/square/any`；空值或其他值会返回 400（`message=Invalid orientation.`）。
- 依赖图片元信息（width/height）已入库；若大量数据未补全元信息，可能出现 `NO_MATCH`。

## `min_width`

`min_width` 用于筛选最小宽度（像素）：

- 不传：不限制
- 传入非负整数：只返回宽度 `>= min_width` 的图片

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?min_width=800"
```

### 注意事项

- `min_width` 必须是非负整数；空值或非法值返回 400（`message=Invalid min_width.`）。
- 与 `min_height`、`min_pixels` 同时使用会更严格，可能更容易出现 `NO_MATCH`。

## `min_height`

`min_height` 用于筛选最小高度（像素）：

- 不传：不限制
- 传入非负整数：只返回高度 `>= min_height` 的图片

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?min_height=800"
```

### 注意事项

- `min_height` 必须是非负整数；空值或非法值返回 400（`message=Invalid min_height.`）。
- 与 `min_width`、`min_pixels` 同时使用会更严格，可能更容易出现 `NO_MATCH`。
