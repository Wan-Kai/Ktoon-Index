# M5 发布校验与失败恢复

M5 将 GitHub Actions 明确分成“事实源校验、重新生成、代码质量、生产构建、发布包校验、部署”六段。部署始终使用本次运行从 Markdown 生成的 `dist`，不信任提交中可能过期的 `data/`。

## CI 数据流

```text
content/entries/*.md
  → verify:content（只读解析与 Schema 校验）
  → build:content（删除旧 data 后完整重建）
  → typecheck + tests
  → Vite build
  → verify:release（核对 dist 与事实源）
  → GitHub Pages artifact
```

`verify:release` 会阻止以下产物进入部署：

- `dist/data/index.json` 或任一详情 JSON 与当前 published Markdown 投影不一致；
- 缺少 published 详情、包含多余详情，或公开 JSON 出现 version、status、SHA、request ID、maintainer；
- `index.html`、`detail.html`、`app.js`、首页数据缺失或任一发布文件为空；
- HTML/CSS 使用站点根路径、引用发布目录之外的路径，或引用不存在的本地资源。

回收条目不进入 `projectContent`，因此也不能进入通过校验的发布包。发布检查只接受最终 `dist`，不会因为仓库根目录仍有旧 JSON 而误判成功。

## 本地复现

完整执行与 CI 相同的门槛：

```bash
npm run verify
```

只排查内容或发布包：

```bash
npm run verify:content
npm run build
npm run verify:release
```

失败输出使用单个 JSON 对象。内容错误通常是 `VALIDATION_FAILED` 或 `BUILD_FAILED`；发布包错误是 `BUILD_FAILED`，`details.problems` 会列出所有已发现的文件、字段或引用问题。

## 恢复语义

构建失败不会修改内容 commit、创建发布状态机或自动回滚。修复对应 Markdown、代码或资源引用后再次提交，下一次 Actions 会从事实源完整重建并自然恢复部署。不能通过跳过失败步骤、保留旧 `dist` 或把校验改成 warning 来恢复。
