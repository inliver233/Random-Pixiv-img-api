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

## 生产建议（高并发 / CDN）

- `/random` 强制 `Cache-Control: no-store`，不建议被 CDN 缓存。
- 高并发/生产环境推荐使用 `redirect=1`：让客户端/CDN 缓存稳定图片 URL（`/i/:id.:ext`）的长缓存响应。
- CDN 建议：
  - 缓存 `GET /i/*`（长 TTL）
  - 不缓存 `GET /random`（no-store）

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

## `r18_strict`（可选）

为了解决“刚导入、元数据尚未补全（`xRestrict` 为空）时 `/random` 频繁 `NO_MATCH`”的问题：

- 默认行为：当 `r18=0` 时，**允许** `xRestrict IS NULL` 的图片参与随机（把“未知”当作全年龄）。
- 严格模式：设置 `r18_strict=1`（或环境变量 `RANDOM_R18_STRICT=true`）后，当 `r18=0` 时 **只** 返回 `xRestrict=0` 的图片（不包含 `NULL`）。

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?r18=0&r18_strict=1"
```

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

## `min_pixels`

`min_pixels` 用于筛选最小像素数：

- 计算方式：`width * height >= min_pixels`
- 不传：不限制
- 传入非负整数：只返回像素数满足条件的图片

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?min_pixels=2073600"
```

### 注意事项

- `min_pixels` 必须是非负整数；空值或非法值返回 400（`message=Invalid min_pixels.`）。
- 依赖图片宽高元信息已入库；若大量数据未补全宽高，可能更容易出现 `NO_MATCH`。

## `included_tags`

`included_tags` 用于筛选“必须包含”的标签（AND 语义）：

- 传入格式：`tag1|tag2|tag3`（`|` 分隔）
- 语义：图片必须同时包含所有给定标签

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?included_tags=cat"
curl -i "http://127.0.0.1:3000/random?included_tags=cat|dog"
```

### 注意事项

- 空值或解析后为空会返回 400（`message=Invalid included_tags.`）。
- 条件越多越严格；与 `excluded_tags`、尺寸过滤叠加时更容易 `NO_MATCH`，必要时可提高 `attempts`。

## `excluded_tags`

`excluded_tags` 用于筛选“必须不包含”的标签（NOT 语义）：

- 传入格式：`tag1|tag2|tag3`（`|` 分隔）
- 语义：只要命中任意一个排除标签就会被过滤掉（OR / NOT）

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?excluded_tags=r18"
curl -i "http://127.0.0.1:3000/random?excluded_tags=r18|r18g"
```

### 注意事项

- 空值或解析后为空会返回 400（`message=Invalid excluded_tags.`）。
- 与 `included_tags` 同时使用时：先做 AND（必须包含）再做 NOT（必须不包含），条件越多越严格。

## `user_id`

`user_id` 用于按 Pixiv 用户 ID 精确筛选：

- 不传：不筛选
- 传入正整数：只返回 `user_id` 匹配的图片

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?user_id=12345678"
```

### 注意事项

- `user_id` 仅接受正整数；空值或非法值返回 400（`message=Invalid user_id.`）。

## `illust_id`

`illust_id` 用于按 Pixiv 作品 ID 精确筛选（便于指定某个作品进行调试/回放）：

- 不传：不筛选
- 传入正整数：只返回 `illust_id` 匹配的图片

### 示例

```bash
curl -i "http://127.0.0.1:3000/random?illust_id=123456789"
```

### 注意事项

- `illust_id` 仅接受正整数；空值或非法值返回 400（`message=Invalid illust_id.`）。
