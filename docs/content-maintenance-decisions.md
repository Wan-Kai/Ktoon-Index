# 内容维护设计决策清单

这份清单是 grilling 会话的防重复索引。已确认事项不再重新提问；若未来改变，直接标记被哪项新决定取代。

## 已确认

- 公开阅读面保持静态、匿名、只读；所有写操作进入独立管理面。
- Skill 负责指导 Agent，CLI 负责调用受控能力；未来 MCP 复用同一个内容模块。
- 权威内容以同一 Git 仓库中的单条目 Markdown 文件保存。
- 第一阶段只有站点所有者本人拥有仓库写权限；不实现多人角色或成员管理。
- Agent 复用站点所有者本机现有的 `gh auth` 身份，不使用独立委托凭证。
- 每个条目恰好属于一个冻结分类：工具箱、产品、文章、标准、点子。
- 标签可多选，从现有条目动态枚举并做轻量规范化，不设独立标签管理模块。
- 所有条目都有详情页。
- 条目只按不可变 ID 判重；ID 默认由标题生成，可在创建时覆盖，回收后也不可复用。
- 新条目通过校验后直接公开，不设草稿、审核或显式发布动作。
- 唯一维护者可以创建和修改全部条目字段，合法新条目直接公开。
- 写操作只接受 JSON；读操作使用普通 CLI 参数。
- 一个条目最多有一个可选来源链接，并可有多个参考链接。
- 个人判断支持受限 Markdown；禁用原始 HTML，不支持图片和附件上传。
- 更新、回收和恢复使用内容版本阻止旧版本覆盖。
- 每次只变更一个条目，每次内容变更对应一个 Git commit，并直接进入 `main`。
- 回收条目立即从公开站撤下但保留恢复能力。
- 构建或发布失败时查看日志或等待下一次提交重试，不建立发布状态机。
- 第一阶段不部署远端管理服务；管理面由本地 CLI 实现，并复用维护者已有的 GitHub 仓库凭据。
- 第一阶段不提供永久清除能力。
- CLI 默认输出 JSON，人类查看列表时可显式选择表格格式。
- Git commit 使用维护者自己的 Git 作者身份，并记录内容版本与请求 ID。
- 第一阶段接受本地 CLI 无法阻止持有仓库写权限者绕过的安全取舍；CLI 是推荐入口，不宣称是不可绕过的强制入口。
- CLI 复用维护者的 `gh auth` 身份，通过 GitHub API 直接修改内容文件，不操作本地工作区。
- 合法变更自动提交到 `main`，不提供暂存、手动 push 或 `--no-push` 模式。
- 文件 SHA 或内容版本冲突时返回 `VERSION_CONFLICT`，不自动合并或重试。
- 未来若部署远端管理服务，使用每位维护者独立的 Bearer API Key，不使用共享 Basic Auth；服务端只保存 Key 哈希。
- 条目使用 YAML Frontmatter 保存结构化字段，Markdown 正文保存个人判断。
- 回收条目保留原文件并将 `status` 改为 `recycled`；恢复时改回 `published`。
- `added_at` 由 CLI 创建时写入且不可修改；`updated_at` 由 CLI 在每次变更时更新。
- 来源链接包含 `title`、`url`；参考链接包含 `title`、`url` 和可选 `description`，域名由 URL 推导。
- 不设置人为的字段字符数、标签数、参考链接数或文件大小上限。
- CLI 提交前校验 Schema、枚举、ID、标签、HTTPS 链接、受限 Markdown、远端 ID、内容版本和文件 SHA；完整网站构建由 GitHub Actions 执行。
- CLI 第一阶段只提供 `doctor`、条目 create/get/list/search/update/delete/restore 与 `tag list`；不提供分类管理、发布、批量、交互或永久删除命令。
- Update 使用 Merge Patch 语义：字段缺失保持、字段出现替换、可选字段 `null` 清空、数组整体替换、必填字段不可清空。
- 每次写操作自动生成 `request_id` 并写入 commit trailer；重试发现同一 ID 已提交时返回原结果，不产生重复 commit。
- `entry list` 返回全部匹配结果，不暴露分页接口。
- GitHub Actions 将 Markdown 生成 `data/index.json` 与 `data/entries/<id>.json`；首页和通用详情页只读取这些公开 JSON，回收条目不进入产物。
- 搜索只匹配标题与摘要并按字符串相关度排序；评价不参与搜索。列表可按分类、标签、评价和时间筛选，首页仍按评价优先展示。
- 受限 Markdown 允许段落、粗体、斜体、列表、行内代码与 HTTPS 链接；禁用原始 HTML、脚本、iframe、内嵌样式、图片和附件。
- 公开 JSON 只包含页面所需内容与 addedAt/updatedAt，不包含 version、status、文件 SHA、维护者、委托执行者、request_id 或 commit 信息。

## 尚未决定

- 无。

## 延后方案

- 远端管理服务与 GitHub App 登录。
- Agent 八小时不可刷新委托凭证及主动撤销。
- 远端服务使用 GitHub App 代表维护者提交内容。
- 每位维护者独立的 Bearer API Key 远端认证。
- GitHub Organization、维护 Team、Owner/Editor 字段权限与多人审计。
