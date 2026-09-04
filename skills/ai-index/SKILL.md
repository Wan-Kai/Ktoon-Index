---
name: ai-index
description: Query and maintain Ktoon's personal AI Index through its controlled project CLI. Use when the user asks to 查询、搜索、查看、新增、修改、评分、加标签、加链接、回收或恢复 AI 收藏内容, or asks an Agent to publish products, articles, tools, standards, or ideas discovered during research.
---

# AI Index

Set `SKILL_DIR` to the absolute directory containing this `SKILL.md`, then use the bundled runner as the only content interface:

```bash
SKILL_DIR="<absolute skill directory>"
RUNNER="$SKILL_DIR/scripts/run-ai-index.sh"
"$RUNNER" <command>
```

Replace the placeholder before execution. The runner locates the repository regardless of the task working directory. Parse JSON stdout on success and the single JSON object on stderr when exit status is nonzero.

## Guardrails

- Route every read and mutation through the bundled runner. Keep the Markdown fact source, generated JSON, page code, Git history, and GitHub API outside the Agent's direct execution path; the CLI owns those internals.
- Use the maintainer's existing `gh auth`; keep credentials out of prompts, files, flags, logs, and skill resources.
- Execute one entry mutation at a time. Preserve immutable IDs and the single-category rule; use tags for additional classification.
- Treat CLI validation, status, version, SHA, and idempotency checks as authoritative. Recover through documented commands rather than bypassing a failed rule.
- Run `doctor` before the first mutation in a task. Stop for user action when authentication or repository access is unavailable.

## Choose the operation

- Find or inspect: use `entry search`, `entry list`, `entry get`, or `tag list` and return the relevant result without mutating.
- Create: search by title and likely keywords first. Create only when no existing entry represents the same item.
- Update: get the exact ID immediately before writing, then patch only the fields required by the user's intent.
- Recycle: get the entry, confirm the requested target is unambiguous, then use `entry delete`. This is reversible and never permanently removes the ID.
- Restore: get the recycled entry, then use `entry restore`.

Read [write-contracts.md](references/write-contracts.md) before constructing any create, update, delete, or restore request. Read [error-recovery.md](references/error-recovery.md) whenever a command fails or its completion is uncertain.

For a research handoff that should publish discoveries as part of the same task, read [research-publishing.md](references/research-publishing.md) before the first candidate. Its capture policy decides what becomes an entry, how research types map to categories, and which fields may be inferred. Continue to use the mutation workflow below for every accepted candidate.

## Read workflow

1. Prefer `entry search <query>` for natural-language lookup. Search only covers title and summary.
2. Use `entry list` for category, tag, rating, time, or sort constraints.
3. Use `entry get <id>` before presenting full content or preparing any mutation.
4. Use JSON output for reasoning. Use `--format table` only when the user explicitly wants a compact human-readable list.

Examples:

```bash
"$RUNNER" entry search "context engineering"
"$RUNNER" entry list --category articles --tag agents --sort added_at
"$RUNNER" entry get mcp-inspector
"$RUNNER" tag list
```

## Mutation workflow

1. Run `doctor` once for the task.
2. Complete the read-first step for the chosen operation.
3. Generate a UUID before the write and retain it with the exact intended request. Pass it as `--request-id`.
4. Send JSON through stdin with `--input -`; avoid persistent request files.
5. Inspect the success receipt. Retain `request_id`, `commit_sha`, `sha`, and `entry.version` until the task is complete.
6. If the outcome is uncertain, retry the exact command with the same request ID. If the user changes the intended content, treat it as a new operation with a new request ID.
7. Report the operation, immutable ID, resulting version, commit SHA, and whether the result was idempotent.

Generate a request ID without introducing another credential or service:

```bash
REQUEST_ID="$(node -e 'console.log(crypto.randomUUID())')"
```

Write via stdin:

```bash
"$RUNNER" entry update mcp-inspector \
  --input - --request-id "$REQUEST_ID" <<'JSON'
{
  "expected_version": 1,
  "expected_sha": "0123456789abcdef0123456789abcdef01234567",
  "patch": { "rating": "夯" }
}
JSON
```

Replace the example guard values with the latest `entry get` response. Never submit placeholders.

## Completion

A read completes when the requested result or a clear empty result is returned. A mutation completes only when the CLI returns `ok: true`; include the receipt fields in the handoff. A successful commit does not guarantee that Pages has finished deploying, so describe publication as queued unless deployment was separately verified.
