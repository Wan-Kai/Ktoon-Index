# AI Index 内容维护实施 Roadmap

本路线图把已经确认的内容维护方案拆成可独立验收的阶段。实施顺序遵循一条原则：先让一个真实条目从 Markdown 完整流向现有页面，再补齐全部 CRUD、Skill 和自动发布，避免基础设施先行而迟迟没有可用闭环。

当前进度：M0 至 M5 已完成。M1 首条纵向链路见 [`m1-vertical-slice.md`](./m1-vertical-slice.md)，M2 查询契约见 [`m2-readonly-cli.md`](./m2-readonly-cli.md)，M3 写入契约见 [`m3-controlled-writes.md`](./m3-controlled-writes.md)，M4 全量事实源与页面读模型见 [`m4-full-migration.md`](./m4-full-migration.md)，M5 发布校验与恢复语义见 [`m5-release-hardening.md`](./m5-release-hardening.md)。下一阶段为 M6 Agent Skill。

## 当前前置条件

M0 启动时工作目录尚不是 Git worktree；现已创建公开仓库 `Wan-Kai/Ktoon-Index`、初始化本地 `main` 并连接 `origin`。后续 CLI/Skill 只面向该项目，不扩展为可操作任意仓库的通用工具。

## 完成定义

项目在满足以下条件时视为第一阶段完成：

- 首页和详情页不再依赖 `app.js` 或 HTML 中的硬编码条目。
- 每个条目由 `content/entries/<id>.md` 唯一描述。
- `ai-index` CLI 可以通过当前维护者的 `gh auth` 完成 doctor、create、get、list、search、update、delete、restore 和 tag list。
- 每次写操作只修改一个条目并产生一个带内容版本和请求 ID 的 Git commit。
- 旧版本写入被拒绝，重复请求不产生重复 commit，回收条目不会出现在公开数据中。
- GitHub Actions 可以验证内容、生成公开 JSON，并继续发布现有静态网站。
- 项目 Skill 只通过 CLI 维护数据，不直接修改 Markdown、生成 JSON 或页面代码。
- 当前首页与详情页视觉在桌面和移动端没有明显回归。

## 目标结构

```text
content/entries/*.md          权威内容
        │
        ├── ai-index CLI      受控读写与 GitHub 提交
        │
        └── content build     校验并生成读模型
                │
                ├── data/index.json
                └── data/entries/<id>.json
                         │
                         ├── index.html + app.js
                         └── detail.html?id=<id>
```

建议新增的代码结构：

```text
src/
  content/
    index.ts                  对外内容模块
    schema.ts                 Entry Schema 与规范化
    markdown.ts               Frontmatter/正文转换
    query.ts                  筛选、搜索与排序
    errors.ts                 稳定错误码
  github/
    client.ts                 GitHub API adapter
    commits.ts                SHA、commit trailer、幂等检查
  cli/
    index.ts                  命令入口
    output.ts                 JSON 与 table 输出
scripts/
  build-content.ts            生成公开 JSON
content/entries/
data/
skills/ai-index/SKILL.md
tests/
  fixtures/
```

## M0：工程基线与视觉冻结

### 任务

- 初始化最小 Node.js + TypeScript 工程，只引入 CLI、Schema、Frontmatter、Markdown 和测试所必需的依赖。
- 确认当前已发布站点对应的 GitHub repository 与默认分支，并建立本地项目与该事实源的明确关系。
- 验证唯一维护者的 `gh auth` 对目标仓库拥有读取与内容写入权限。
- 固定 Node 版本、格式化、类型检查和测试命令。
- 保存当前首页和 MCP Inspector 详情页的桌面、平板、移动端基线截图。
- 将现有演示数据、页面行为和五个固定分类整理成测试 fixture。
- 明确生成目录 `data/` 不允许人工编辑。

### 验收

- `npm test`、`npm run typecheck` 和 `npm run build:content` 有稳定入口。
- 当前静态页面在未迁移数据前保持可运行。
- 基线截图和 fixture 可被后续阶段重复使用。

## M1：首个条目纵向切片

### 任务

- 定义 Entry Schema、评分与分类枚举、标签规范化、HTTPS 链接校验和受限 Markdown 规则。
- 实现 Frontmatter 与领域对象的双向转换。
- 实现 `version`、`added_at`、`updated_at`、`status` 的系统字段规则。
- 建立最小内容模块，只开放完成纵向切片所需的 create 和 get。
- 实现最小 CLI：`doctor`、`entry create --input` 和 `entry get <id>`。
- 实现最小 GitHub adapter：通过 `gh auth` 读取目标路径、检查 ID，并把单个 Markdown 文件提交到 `main`。
- 从现有内容中选一条资料完整的条目作为样例；当前暂用 MCP Inspector，因为首页与详情页均已有对应内容和视觉基线。它只是测试数据，不代表引入 MCP 协议或 MCP Server。
- 使用 `ai-index entry create` 把该样例写成第一份 `content/entries/<id>.md`，禁止手工创建事实源。
- 生成对应的 `data/index.json` 与 `data/entries/mcp-inspector.json`。
- 建立最小 GitHub Actions 链路，在内容 commit 后运行校验与 JSON 构建，并更新静态站。
- 让首页和详情页优先读取生成数据，完成一条从 Markdown 到真实 UI 的完整链路。

### 验收

- 一次 `ai-index entry create` 可以完成 JSON 输入、CLI 校验、Markdown 提交、Actions 构建、公开 JSON 生成和页面展示。
- `ai-index entry get` 能从 GitHub 上读取刚创建的条目及 version。
- 页面中不再存在该样例条目的重复事实源。
- 生成 JSON 不包含 version、status、SHA、维护者或请求 ID。
- 与视觉基线对比无明显布局回归。

## M2：只读 CLI 与查询语义

### 任务

- 在 M1 的内容模块上补齐 list、search 和 tag list，不另建一套读取逻辑。
- 实现标题与摘要字符串匹配及相关度排序。
- 实现分类、标签、评价和时间筛选，以及首页评价优先排序。
- 实现 JSON 默认输出和 `--format table`。
- 完善 `doctor`，覆盖 Node、`gh auth`、目标仓库访问和内容构建能力。
- 增加 GitHub 读取 adapter 与内存测试 adapter。

### 验收

- 读命令对本地 fixture 和 GitHub adapter 返回相同领域结果。
- 搜索不匹配评价文本，标签规范化后不会重复枚举。
- 所有失败返回稳定的机器可读错误结构。

## M3：受控写入与并发保护

### 任务

- 加固 M1 的 create，完整覆盖自动 ID、显式 ID、已发布 ID 和已回收 ID 冲突。
- 实现 Merge Patch update：缺失保持、出现替换、`null` 清空可选字段、数组整体替换。
- 实现 delete 和 restore，通过 `status` 原位切换状态。
- 对 update、delete、restore 强制校验 `expected_version` 和远端文件 SHA。
- 每次写操作自动维护时间和递增 version。
- 复用 M1 的 GitHub 写入路径，确保所有写命令都是单文件、单条目 commit 并直接进入 `main`。
- Commit message/trailer 写入 operation、entry ID、content version 和 request ID。
- 实现 request ID 幂等检查，处理“GitHub 已提交但客户端超时”的重试场景。

### 验收

- CRUD 全部通过自动化测试和 GitHub sandbox 集成测试。
- 旧版本修改稳定返回 `VERSION_CONFLICT`，不产生 commit。
- 相同 request ID 重试返回原结果，只存在一个 commit。
- 任意校验失败都不会产生远端文件或 commit。
- CLI 不读取或写入当前本地工作区内容。

## M4：全量内容迁移与页面数据化

### 任务

- 将当前工具箱、产品、文章、标准、点子全部演示条目迁移为 Markdown。
- 删除 `app.js` 中的硬编码 categories/entries 数据。
- 把详情页标题、摘要、分类、标签、评价、时间、个人判断和链接全部改为数据驱动。
- 确保所有条目都有详情页；空的可选区块不渲染占位内容。
- 首页继续展示每类评分最高三条，未评分内容不补位。
- 保持界面中英文切换只影响界面文案，不翻译内容。

### 验收

- 搜索、分类、评分排序、标签和时间行为与确认需求一致。
- 五个分类顺序固定，点子位于最后。
- 任何已发布条目都能打开通用详情页。
- 回收一个条目后，它从首页、搜索和详情数据中消失；恢复后重新出现。
- 桌面和移动端截图通过视觉回归检查。

## M5：GitHub Actions 硬化与发布完善

### 任务

- 在 M1 最小 Actions 链路上补齐 Schema、类型、测试、内容构建和静态资源检查。
- 生成 `data/index.json` 与 `data/entries/*.json`，并验证没有回收条目或维护字段泄漏。
- 将生成数据接入当前静态站发布流程。
- 构建失败时保留清晰日志，不创建发布状态机或自动回滚内容 commit。
- 防止生成文件与 Markdown 不一致：CI 必须从事实源重新生成，而不是信任提交中的旧 JSON。

### 验收

- 对 Markdown 的一次合法修改可以自动触发构建并更新线上页面。
- 非法分类、非 HTTPS 链接、危险 Markdown 或损坏 Frontmatter 会使 CI 明确失败。
- 下一次修复提交可以自然恢复发布。

## M6：Agent Skill

### 任务

- 创建项目专用 `ai-index` Skill，固定项目位置和 CLI 调用方式。
- 明确 Agent 工作流：先 search/get，再 create/update；修改前读取 version；冲突后重新读取；禁止直接编辑 Markdown。
- 提供创建、补充个人判断、调整评价、添加链接、回收和恢复的少量示例。
- 把错误码转成 Agent 可执行的恢复策略，不通过提示词绕过 CLI 校验。
- Skill 不保存 GitHub Token，不包含远端管理、多用户或附件能力。

### 验收

- Agent 能通过自然语言完成一次 create、update、delete、restore 闭环。
- Agent 遇到重复 ID、版本冲突和校验失败时走正确恢复路径。
- 仓库中不存在 Skill 直接写文件的备用流程。

## M7：硬化、切换与交付

### 任务

- 补齐错误码契约：`NOT_FOUND`、`ID_CONFLICT`、`VERSION_CONFLICT`、`VALIDATION_FAILED`、`AUTH_REQUIRED`、`FORBIDDEN`、`GITHUB_ERROR`、`BUILD_FAILED`。
- 覆盖 Frontmatter 注入、危险协议、原始 HTML、异常 Unicode 标签和损坏 JSON 等安全测试。
- 在 disposable GitHub sandbox 验证真实 API 权限、SHA 冲突、幂等和 commit trailer。
- 完成旧硬编码删除后的全站回归。
- 编写维护者快速使用文档与故障排查文档。
- 保留切换前静态版本的可恢复 tag。

### 验收

- 完成定义中的全部条件有自动化或人工证据。
- 本地 CLI、GitHub Actions、公开站和 Skill 使用同一份 Schema 与查询规则。
- 从旧静态版本恢复有明确步骤且经过演练。

## 推荐执行顺序

```text
M0 基线
  ↓
M1 首个条目纵向切片
  ↓
M2 只读 CLI
  ↓
M3 写入与并发
  ↓
M4 全量迁移
  ↓
M5 CI 与发布
  ↓
M6 Skill
  ↓
M7 硬化交付
```

M1 是第一个必须尽快完成的里程碑。如果 M1 不能让一份 Markdown 无损驱动现有首页和详情页，后续 CLI、GitHub 写入和 Skill 都不应继续扩展。这里的 MCP Inspector 仅是当前资料最完整的样例条目，与是否建设 MCP 能力无关。

## 暂不进入 Roadmap

- 多维护者与 Owner/Editor 权限。
- 远端管理服务、GitHub App、Bearer API Key。
- MCP adapter。
- 草稿、审核、PR、批量操作和永久删除。
- 分类管理、附件上传、图片托管和独立标签管理。
- 数据库、全文搜索服务和发布状态机。
