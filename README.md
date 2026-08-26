# Ktoon AI Index

Ktoon 的个人 AI 信息索引，用来公开整理工具、产品、文章、行业标准与点子。

M0–M9 已完成：20 个条目由 `content/entries/*.md` 唯一描述；GitHub Actions 每次从事实源重建并校验后部署。CLI 可以通过 `gh auth` 完成单条目的完整 CRUD 与查询，项目 Skill 将自然语言意图稳定映射到同一 CLI，不保存凭据或提供直接写文件的备用路径。M7 完成内容维护第一阶段交付，M8 完成真实浏览器性能硬化，M9 补齐公开站可发现性与分享元信息。

## 本地运行

```bash
npm install
npm run dev
```

默认访问 `http://127.0.0.1:5173/`。如端口被占用，以 Vite 输出为准。

## 内容 CLI

```bash
npm run ai-index -- doctor
npm run ai-index -- entry get mcp-inspector
npm run ai-index -- entry list --format table
npm run ai-index -- entry search inspector
npm run ai-index -- tag list
npm run ai-index -- entry update mcp-inspector --input update.json
npm run ai-index -- entry delete mcp-inspector --input guard.json
npm run ai-index -- entry restore mcp-inspector --input guard.json
```

## 质量检查

```bash
npm run format:check
npm run typecheck
npm test
npm run build:content
npm run build
npm run verify
```

## 项目文档

- [内容维护 Roadmap](docs/content-maintenance-roadmap.md)
- [M0 工程基线](docs/m0-engineering-baseline.md)
- [M1 首个条目纵向切片](docs/m1-vertical-slice.md)
- [M2 只读 CLI 与查询语义](docs/m2-readonly-cli.md)
- [M3 受控写入与并发保护](docs/m3-controlled-writes.md)
- [M4 全量迁移与页面数据化](docs/m4-full-migration.md)
- [M5 发布校验与失败恢复](docs/m5-release-hardening.md)
- [M6 Agent Skill](docs/m6-agent-skill.md)
- [M7 硬化与交付证据](docs/m7-hardening-delivery.md)
- [M8 页面性能硬化](docs/m8-performance-hardening.md)
- [M9 可发现性与分享基础](docs/m9-discoverability.md)
- [维护者指南](docs/maintainer-guide.md)
- [产品定义](PRODUCT.md)
- [设计规范](DESIGN.md)
