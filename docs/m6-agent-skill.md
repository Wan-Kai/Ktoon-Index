# M6 Agent Skill

M6 把自然语言维护意图稳定映射到已经完成的 `ai-index` CLI，不新增第二套读取、写入、鉴权或校验逻辑。

## 结构

```text
skills/ai-index/
  SKILL.md                         核心编排与完成标准
  agents/openai.yaml              Codex UI 元数据
  scripts/run-ai-index.sh         与当前 cwd 无关的 CLI 定位器
  references/write-contracts.md   写入 JSON 与少量示例
  references/error-recovery.md    错误码恢复策略
```

Skill 是 model-invoked：当用户要求查询或维护个人 AI Index 时可以自动触发，也支持显式 `$ai-index`。正文只保留每次都需要的读优先、单条操作、并发与幂等工作流；精确 JSON 和失败分支按需加载。

## 执行边界

- 所有内容操作只调用 `scripts/run-ai-index.sh`，后者只定位并执行仓库内现有 CLI。
- Skill 不直接操作事实源 Markdown、生成 JSON、页面代码、Git 或 GitHub API。
- Skill 不保存或传递 Token，只复用维护者本机 `gh auth`。
- 每次 mutation 先读取最新 version 与 blob SHA，显式生成 request ID，并通过 stdin 发送 JSON。
- 网络结果不确定时以同一 request ID 重试同一请求；版本冲突或内容修正属于新请求。
- 回收是可恢复状态切换；没有永久删除、批量、分类管理、附件或多人能力。

## 自然语言映射

| 意图 | CLI 工作流 |
| --- | --- |
| 查找、浏览、筛选 | search/list，必要时 get |
| 新增收藏 | search 去重 → create |
| 补充个人判断、评价、标签或链接 | get → update |
| 移除公开内容 | get → delete |
| 恢复内容 | get → restore |

## 完成语义

只读操作以得到结果或明确空结果为完成。写操作必须得到 `ok: true` 回执，并向用户返回 ID、version、commit SHA 和 idempotent。Git commit 成功只代表内容已进入 `main`；没有额外检查 Actions 时，Skill 应将站点更新描述为等待发布。

## 验证

- Skill 结构通过官方 `quick_validate.py`。
- 自动测试从仓库外 cwd 调用 runner，证明固定定位不依赖当前任务目录。
- 自动测试验证 runner 暴露完整 CRUD、非法输入在联网前以稳定 JSON 失败、脱离仓库时只返回 BUILD_FAILED；领域测试单独覆盖未知创建/链接字段。
- 真实 `doctor`、search、get、tag list 通过 runner 执行；写入恢复语义由现有 M3 adapter 与 mutation 测试覆盖，不为 Skill 建造第二套 mock 领域层。
