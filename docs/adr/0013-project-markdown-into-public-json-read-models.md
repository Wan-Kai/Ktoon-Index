# 将 Markdown 投影为公开 JSON 读模型

Git 中的单条目 Markdown 是唯一事实源，GitHub Actions 将已发布内容投影为首页 `data/index.json` 和详情 `data/entries/<id>.json`。现有通用详情页按 ID 读取单条 JSON，不为每个条目生成独立 HTML；回收条目和维护侧字段不进入公开产物。
