# M2 只读 CLI 与查询语义

## 命令

```bash
ai-index doctor
ai-index entry get <id>
ai-index entry list [filters]
ai-index entry search <query> [filters]
ai-index tag list [--format json|table]
```

仓库内可使用：

```bash
npm run ai-index -- entry list
./bin/ai-index.js entry search inspector --format table
```

## 筛选参数

`entry list` 与 `entry search` 共享：

- `--category toolkit|products|articles|standards|ideas`
- `--tag <tag...>`：多个标签为 AND。
- `--rating 夯|人上人|NPC|unrated`
- `--added-after <ISO|YYYY-MM-DD>`：包含端点。
- `--added-before <ISO|YYYY-MM-DD>`：包含端点。
- `--sort rating|added_at`：默认 `rating`。
- `--format json|table`：默认 `json`。

所有匹配结果一次返回，不提供分页。

## 搜索与排序

搜索只匹配标题和摘要，NFKC 后不区分大小写：

1. 标题精确匹配：300。
2. 标题包含：200。
3. 摘要包含：100。

评分、分类、标签、个人判断和链接不参与字符串搜索。同分时按录入时间倒序，再按标题稳定排序。

`rating` 排序为 `夯 > 人上人 > NPC > unrated`，同级按录入时间倒序。`added_at` 直接按录入时间倒序。

## Adapter

- `GitHubEntryReader`：从固定仓库 `main/content/entries/*.md` 读取并逐条通过统一 Markdown/Schema 校验。
- `MemoryEntryReader`：供测试和未来离线场景使用。
- 两者只返回 Entry；筛选、搜索、标签枚举全部由 `src/content/query.ts` 完成。

Adapter 不读取公开 JSON，也不各自实现查询规则。

## Doctor

`doctor` 依次检查：

1. Node 满足 `>=22.23.1 <23`。
2. 当前 `gh auth` 可以写 `Wan-Kai/Ktoon-Index/main`。
3. `build:content --check` 可以解析所有事实源并完成公开投影。

内容检查模式不改写 `data/`。

## M4 后的数据边界

M2 最初只有 MCP Inspector 一份权威内容。M4 已迁移全部 20 条 Markdown，因此真实 list/search/tag 与公开站使用同一完整集合；CLI 和构建器均不再读取 legacy JSON。
