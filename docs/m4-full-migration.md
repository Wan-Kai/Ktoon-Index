# M4 全量内容迁移与页面数据化

M4 删除运行时 legacy 内容桥。站点当前 20 个条目全部由 `content/entries/<id>.md` 唯一描述，`data/` 只是可重复生成的公开读模型。

## 迁移规则

- 保留 19 条 legacy 内容的不可变 ID、标题、摘要、分类、评分和原录入时间。
- 原 HTTPS 外链映射为详情页主来源；历史 `#...` 占位锚点被舍弃，不伪造来源。
- 没有现成资料的个人判断、标签、来源和参考链接保持为空。
- 每个迁移条目从 `version=1`、`status=published` 开始，`added_at` 与 `updated_at` 初始相同。
- MCP Inspector 保留 M1 已有的丰富正文、标签和链接，不生成第二份内容。
- 本轮是一次性仓库迁移，19 个历史条目通过与 CLI 相同的领域模型和序列化器批量落盘；M4 之后恢复为单条 CLI 写入，不开放批量写接口。

`tests/fixtures/current-content.json` 只用于证明 M0 视觉内容基线，不进入内容构建、CLI 或页面运行时。

## 读模型

```text
content/entries/*.md (20)
  → build:content
  → data/index.json (5 categories / 20 entries)
  → data/entries/*.json (20 details)
```

构建器只投影 `published` 条目：

- 分类顺序固定为 Toolkit、Products、Articles、Standards、Ideas。
- 分类内默认按 `夯 > 人上人 > NPC > unrated`，同级按 addedAt 倒序。
- 首页 JSON 包含全部条目，但页面每类只展示评分最高三条；未评分不补位。
- 所有首页和搜索链接统一为 `detail.html?id=<immutable-id>`。
- 每个详情 JSON 使用字段白名单，不包含 version、status、blob SHA、request ID 或 commit 信息。
- `recycled` 条目不进入 index，也不生成 detail 文件；restore 后原位返回。

## 页面行为

- `app.js` 启动时 categories 为空，只从 `data/index.json` 加载内容。
- `?category=<fixed-id>` 展示该分类全部条目，支持评分优先/录入时间排序、单标签和 7/30/365 天时间筛选；未知分类明确失败。
- 搜索始终覆盖全部五类，只匹配标题与摘要，不与当前分类、标签或时间筛选叠加。
- 详情页从 `data/entries/<id>.json` 填充标题、摘要、分类、标签、评价、时间、判断与链接。
- UI 中英文切换只改变界面文案和固定分类标签，不翻译条目内容。
- 空评分、标签、链接、个人判断与参考资料对应的可选区块不渲染占位内容。

## 删除的兼容面

- `content/legacy-index.json`
- `app.js` 中硬编码的 categories/entries
- 首页外链和历史站内占位锚点作为条目主入口

内容更新只能进入 Markdown/CLI 链路；不得重新在页面脚本、HTML 或生成 JSON 中维护事实副本。
