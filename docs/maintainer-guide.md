# AI Index 维护者指南

本指南面向当前唯一维护者。公开站保持匿名只读；内容维护通过本机 Agent Skill 或 `ai-index` CLI 完成，并直接提交到固定仓库 `Wan-Kai/Ktoon-Index/main`。

## 快速开始

```bash
nvm use
npm ci
./skills/ai-index/scripts/run-ai-index.sh doctor
```

`doctor` 必须同时报告 Node 受支持、GitHub 已认证且可写、内容构建可验证。认证失效时由维护者执行 `gh auth login`，Skill 和仓库均不保存 Token。

日常优先直接告诉 Agent 自然语言意图，例如：

- “在 AI Index 里找一下 MCP 调试工具。”
- “把 MCP Inspector 的评价改成夯。”
- “新增这篇文章，并加上我的判断。”
- “回收这个条目”或“恢复这个条目”。

Agent 使用 `$ai-index`，按 search/get → 单条 mutation 的顺序执行。需要人工查看时也可直接运行：

```bash
./skills/ai-index/scripts/run-ai-index.sh entry search "MCP"
./skills/ai-index/scripts/run-ai-index.sh entry get mcp-inspector
./skills/ai-index/scripts/run-ai-index.sh entry list --category toolkit --format table
./skills/ai-index/scripts/run-ai-index.sh tag list --format table
```

写入 JSON、并发护栏和 request ID 规则见 [M3 受控写入](./m3-controlled-writes.md)；Agent 的精确输入模板位于 [`skills/ai-index/references/write-contracts.md`](../skills/ai-index/references/write-contracts.md)。

## 写入完成标准

写操作只有收到 `ok: true` 才算成功。记录以下回执，直到本次维护结束：

- `request_id`：网络结果不确定时原样重试的幂等键；
- `commit_sha`：本次内容 commit；
- `sha`：下一次 mutation 使用的 blob SHA；
- `entry.version`：下一次 mutation 使用的内容版本；
- `idempotent`：`true` 表示恢复了已完成请求，没有新增 commit。

写入成功表示内容已进入 `main`，不等于 Pages 已完成部署。需要确认公开状态时查看最新 `Verify and deploy` workflow；build 与 deploy 都成功后再检查线上页面。

## 错误码与处理

| 错误码 | 含义 | 维护者动作 |
| --- | --- | --- |
| `VALIDATION_FAILED` | JSON、字段、枚举、标签、Markdown、状态或 request ID 不合法 | 根据 `details` 修正输入；内容改变后使用新 request ID |
| `NOT_FOUND` | 不可变 ID 不存在 | search/list 确认 ID；只有确实是新内容才 create |
| `ID_CONFLICT` | 创建 ID 已被 published 或 recycled 条目占用 | get 现有条目；同一内容改用 update，不同内容使用不同显式 ID |
| `VERSION_CONFLICT` | version、blob SHA 或 GitHub CAS 已过期 | 重新 get，基于新内容重做 patch，并使用新 request ID |
| `AUTH_REQUIRED` | `gh` 未登录或认证失效 | 维护者执行 `gh auth login` 后重跑 doctor |
| `FORBIDDEN` | 当前身份没有固定仓库 main 写权限 | 恢复仓库权限；Skill 不尝试替代凭据 |
| `GITHUB_ERROR` | GitHub API、网络、响应或 commit 历史异常 | 结果不确定时以同 request ID 原样重试一次；仍失败则停止并保留错误详情 |
| `BUILD_FAILED` | Node、内容构建或最终发布包不满足要求 | 本地运行 `npm run verify`，或查看 Actions 首个失败步骤 |

## 发布排查

本地完整门禁：

```bash
npm run verify
```

Actions 按以下顺序运行：事实源校验、重新生成、格式、类型、测试、生产构建、发布包校验、Pages 上传与部署。修复首个失败阶段后提交到 `main` 即可自然恢复；没有发布状态机或自动回滚。

常见定位：

- 内容校验失败：只把 `content/entries/<id>.md` 用作问题定位依据，随后通过 Skill/CLI 使用同一 Schema 修复，禁止直接编辑事实源；
- 生成数据不一致：运行 `npm run build:content`，不要手工修补 `data/`；
- 静态资源失败：运行 `npm run build && npm run verify:release`；
- GitHub 写入异常：先 `doctor` 和 `entry get`，再核对 request ID 对应 commit trailers；
- Pages 尚未更新：确认 workflow 的 deploy job，而不重复提交相同 mutation。

## 从静态恢复点恢复

`static-v1-before-m7` 是 M7 切换前的 annotated tag，指向已通过 M6 的静态站版本。恢复采用普通 commit，不 force-push：

```bash
git fetch origin main --tags
git switch main
git pull --ff-only origin main
git status --short
git restore --source=static-v1-before-m7 --staged --worktree .
git diff --cached --stat
npm ci
npm run verify
git commit -m "revert: restore static v1 before M7"
git push origin main
```

执行前要求工作区为空；查看 staged diff 确认目标确实是完整恢复。push 后正常 Actions 会重新构建并部署 tag 对应文件。恢复不删除 Git 历史，也不移动 tag。

若只演练而不切换生产，改在临时分支执行 restore、验证 workflow 后删除分支。M7 交付采用该方式完成过恢复演练。
