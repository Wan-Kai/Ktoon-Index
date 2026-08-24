# 条目使用 Frontmatter 并原位回收

每个条目文件以 YAML Frontmatter 保存 ID、标题、摘要、分类、标签、评价、版本、链接、时间和状态，以 Markdown 正文保存个人判断。回收不移动文件，只把 `status` 从 `published` 改为 `recycled`，因此一次回收或恢复仍只修改一个文件，并可通过 GitHub API 原子提交。
