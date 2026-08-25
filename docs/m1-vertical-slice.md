# M1 首个条目纵向切片

## 已贯通链路

```text
create JSON
  → ai-index entry create
  → Entry Schema / 受限 Markdown
  → gh api 单文件提交到 main
  → content/entries/mcp-inspector.md
  → build:content
  → data/index.json + data/entries/mcp-inspector.json
  → 首页 / 通用详情页
```

MCP Inspector 由 CLI 创建，不是人工添加的事实源：

- Request ID：`b172cb7e-913a-4bba-ab46-37b10ba47202`
- Content commit：`e648cf9dac31527ea97fb28f25df4b5468701d49`
- Content version：`1`
- GitHub path：`content/entries/mcp-inspector.md`

## CLI

```bash
npm run ai-index -- doctor
npm run ai-index -- entry create --input entry.json
npm run ai-index -- entry get mcp-inspector
```

也可以执行本地 bin：

```bash
./bin/ai-index.js doctor
```

写命令只接受 JSON，固定写入 `Wan-Kai/Ktoon-Index` 的 `main`，通过当前维护者的 `gh auth` 调用 GitHub Contents API，不修改当前工作区。重复 ID 返回 `ID_CONFLICT`，不会产生第二个 commit。

## 内容契约

- 分类：`toolkit`、`products`、`articles`、`standards`、`ideas`。
- 评价：`夯`、`人上人`、`NPC` 或 `null`。
- 标签：NFKC、去空白、转小写、空白折叠为连字符、按首次出现去重。
- 链接：只允许 HTTPS，不允许内嵌用户名和密码。
- 个人判断：只允许段落、粗体、斜体、列表、行内代码和 HTTPS 链接。
- 系统字段：创建时固定 `version=1`、`status=published`，并由 CLI 生成 `added_at` 与 `updated_at`。

公开 JSON 使用字段白名单，不包含 version、status、文件 SHA、请求 ID 或维护者信息。

## M1 兼容桥

M1 只迁移 MCP Inspector。其余 19 条内容暂时从 `content/legacy-index.json` 进入 `data/index.json`；该兼容文件不含 MCP Inspector，构建器再加入 Markdown 投影，因此迁移样例只有一个事实源。M0 fixture 仅作历史测试证据，不参与运行时构建。这个兼容桥在 M4 全量迁移时整体删除。

## 自动化

`.github/workflows/verify-and-deploy.yml` 在 main 更新后执行：

1. 从 Markdown 重新生成公开 JSON。
2. 检查格式与 TypeScript。
3. 运行测试。
4. 构建站点，并把 `data/` 复制到 `dist/data/`。
5. 部署 GitHub Pages。

Actions 不信任仓库中可能过期的生成文件；每次部署都会重新生成。

## 验证结果

- `doctor` 在真实仓库确认认证、main 与写权限。
- `entry create` 真实创建远端 commit；同 ID 第二次创建返回 `ID_CONFLICT`。
- `entry get` 从 GitHub 读回 version 1 与文件 SHA。
- 内容构建生成五分类、20 条首页数据和 1 份详情数据。
- Chrome 实测 1440×900、1024×900、390×844，首页与详情页无横向溢出。
- 首页搜索 MCP Inspector 返回 1 条；中英文切换只改变界面文案。
