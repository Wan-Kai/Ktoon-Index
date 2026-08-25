# M3 受控写入与并发保护

M3 在 M1/M2 的同一 Entry Schema、Markdown 与 GitHub adapter 上补齐 update、delete、restore。它不引入本地 Git 写入、PR、批量操作、永久删除或第二套事实源。

## 命令

```bash
ai-index entry create --input create.json [--request-id <uuid>]
ai-index entry update <id> --input update.json [--request-id <uuid>]
ai-index entry delete <id> --input guard.json [--request-id <uuid>]
ai-index entry restore <id> --input guard.json [--request-id <uuid>]
```

所有内容写入仍只接受 JSON。`--request-id` 是操作元数据，不是条目字段：省略时 CLI 自动生成 UUID；Agent 若希望在网络超时后安全重试，应在第一次调用前生成 UUID，并在每次重试中传入同一个值。

成功回执统一包含：

```json
{
  "ok": true,
  "command": "entry update",
  "request_id": "123e4567-e89b-42d3-a456-426614174000",
  "commit_sha": "...",
  "sha": "...",
  "path": "content/entries/mcp-inspector.md",
  "idempotent": false,
  "entry": { "id": "mcp-inspector", "version": 2 }
}
```

`idempotent=true` 表示本次没有产生新 commit，而是从原 request commit 还原了当时的条目、blob SHA 和结果。

## Update JSON

```json
{
  "expected_version": 1,
  "expected_sha": "完整的 40 位 Git blob SHA",
  "patch": {
    "rating": "人上人",
    "tags": ["mcp", "debugging"],
    "source": null,
    "references": [],
    "personal_take": "更新后的个人判断"
  }
}
```

Merge Patch 规则：

- 字段缺失：保持现值。
- 字段出现：替换现值。
- `rating`、`source`：允许 `null` 清空。
- `tags`、`references`：数组整体替换，传 `[]` 清空。
- `title`、`summary`、`category`：必填字段不可为 `null`。
- `id`、`version`、`status`、`added_at`、`updated_at`：不允许出现在 patch。
- 空 patch、未知字段和没有实际变化的 patch：拒绝，不产生 commit。

Update 只允许修改 `published` 条目；回收条目必须先 restore。

## Delete / Restore JSON

```json
{
  "expected_version": 2,
  "expected_sha": "完整的 40 位 Git blob SHA"
}
```

Delete 不删除文件，只把 `status` 从 `published` 改为 `recycled`；restore 原位改回 `published`。两者保留 ID、内容和 `added_at`，递增 version 并更新 `updated_at`。重复的新 delete/restore 请求会因状态不符失败；真正的网络重试应复用原 request ID。

## 并发保护

每次 update/delete/restore 同时校验：

1. `expected_version` 等于远端 Entry version。
2. `expected_sha` 等于 GitHub Contents API 返回的当前 blob SHA。
3. PUT 请求把同一 SHA 交给 GitHub 做最终 CAS。

任一值过期都返回 `VERSION_CONFLICT`，不会自动读取新值后覆盖，也不会自动合并或重试。调用方应重新 `entry get <id>`，基于新内容决定下一次变更。

## 幂等与审计

每个内容 commit 都带四个 trailer：

```text
Operation: update
Entry-ID: mcp-inspector
Content-Version: 2
Request-ID: 123e4567-e89b-42d3-a456-426614174000
```

CLI 会分页检查固定仓库 main 的完整 commit 历史：

- 相同 request ID、相同条目、相同操作：读取原 commit ref，返回原结果，不再 PUT。
- 相同 request ID 被用于其他条目或操作：`VALIDATION_FAILED`。
- PUT 返回超时/失败但 GitHub 实际已经提交：再次检查历史并恢复原成功结果。
- 同一 request ID 对应多个 commit 或 trailer/历史文件不一致：`GITHUB_ERROR`，停止写入并人工排查。

## 错误与安全边界

- `ID_CONFLICT`：创建 ID 已存在，无论当前状态是 published 还是 recycled。
- `VERSION_CONFLICT`：内容版本、blob SHA 或 GitHub CAS 已过期。
- `VALIDATION_FAILED`：JSON、Merge Patch、状态、request ID 或内容规则非法。
- `NOT_FOUND`：目标条目不存在。
- `AUTH_REQUIRED` / `FORBIDDEN` / `GITHUB_ERROR`：认证、权限或 GitHub API 失败。

所有 JSON、request ID 与 patch 校验都在 doctor/内容 API 之前完成。CLI 只通过 `gh api` 操作固定的 `Wan-Kai/Ktoon-Index/main`，不会读取或写入当前本地工作区内容。
