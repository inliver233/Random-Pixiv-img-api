# 分类/检索 API（tags / authors / images）

本文定义本项目的“分类/检索”接口语义，并明确与现有 `/random` 的筛选参数与返回格式保持一致。

## 总览

- `GET /random`：随机挑图（支持筛选 + `format=image|json` + `redirect=1`）。详见 `docs/api/random.md`。
- `GET /tags`：标签检索（JSON）。
- `GET /authors`：作者检索（JSON）。
- `GET /images`：图片列表检索（JSON）。
- `GET /images/:id`：单图元信息（JSON，已存在）。
- `GET /i/:id.:ext`：稳定图片 URL（binary，长缓存，已存在）。

> 约定：除 `/random` 与 `/i/*` 外，本文新增的检索接口均返回 JSON，且默认 `Cache-Control: no-store`。

## `/random` 的多格式返回规则（契约）

`/random` 统一使用以下规则（不依赖 `Accept`）：

- `redirect=1`：优先返回 `302`，`Location` 指向稳定图片 URL（`/i/:id.:ext`）；此时 `format` 被忽略。
- `redirect=0`（默认）：
  - `format=image`（默认）：返回图片流（binary）。
  - `format=json`：返回 JSON（包含图片元信息与可用 URL）。

## 通用筛选参数（与 `/random` 兼容）

下述筛选参数 **在 `/random` 与 `/images`（列表检索）中语义一致**：

- `r18=0|1|2`：对应 `xRestrict`（见 `docs/api/random.md`）。
- `r18_strict=1`：当 `r18=0` 时是否排除 `xRestrict IS NULL`。
- `orientation=any|portrait|landscape|square`
- `min_width=<int>=0`、`min_height=<int>=0`、`min_pixels=<int>=0`
- `included_tags`：支持 `|` / `,` / 重复 query param（AND 语义；详见 `docs/api/random.md`）
- `excluded_tags`：支持 `|` / `,` / 重复 query param（NOT 语义；详见 `docs/api/random.md`）
- `user_id=<pixiv_user_id>`：精确作者筛选
- `illust_id=<pixiv_illust_id>`：精确作品筛选

## `GET /tags`（标签检索）

用于在 UI 中提供标签联想/筛选。

### Query

- `q`：可选，按 `name/translated_name` 模糊匹配（大小写不敏感）。
- `limit`：可选，默认 `20`，最大 `100`。
- `cursor`：可选，游标分页（实现建议：按 `id` 升序；返回 `next_cursor` 供继续拉取）。

### Response（JSON）

```json
{
  "items": [
    { "id": 1, "name": "cat", "translated_name": "猫", "image_count": 123 }
  ],
  "next_cursor": "1"
}
```

## `GET /authors`（作者检索）

用于在 UI 中提供作者联想/筛选（Pixiv 用户维度）。

### Query

- `q`：可选，模糊匹配 `user_name`；当 `q` 为纯数字时可按 `user_id` 精确匹配。
- `limit`：可选，默认 `20`，最大 `100`。
- `cursor`：可选，游标分页（实现建议：按 `user_id` 升序；返回 `next_cursor`）。

### Response（JSON）

```json
{
  "items": [
    { "user_id": 123456, "user_name": "alice", "image_count": 42 }
  ],
  "next_cursor": "123456"
}
```

## `GET /images`（图片列表检索）

用于按条件列出图片（分页 + 筛选），并为 `/random` 的筛选提供可解释的“候选集”视图。

### Query

- 通用筛选参数：见上文“通用筛选参数（与 `/random` 兼容）”
- `limit`：可选，默认 `50`，最大 `200`
- `cursor`：可选，游标分页（实现建议：按 `id` 降序；`cursor` 表示“上一页最后一条的 id”）

### Response（JSON）

```json
{
  "items": [
    {
      "id": 1,
      "illust_id": 123,
      "page_index": 0,
      "ext": "jpg",
      "width": 1000,
      "height": 800,
      "x_restrict": 0,
      "user_id": 123456,
      "user_name": "alice",
      "status": "active",
      "tags": ["cat", "dog"]
    }
  ],
  "next_cursor": "1"
}
```

## `GET /images/:id`（单图元信息）

返回指定图片的元信息（已存在）。建议 UI 在列表中点击某条图片后使用该接口拿到完整 tags 与失败信息。

## 错误响应（JSON）

约定所有 JSON 错误响应返回：

```json
{ "code": "BAD_REQUEST", "message": "Invalid ...", "request_id": "..." }
```

详见 `docs/errors.md` 的错误码与可观测性约定。
