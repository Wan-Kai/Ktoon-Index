# Ktoon AI Index

Ktoon 的个人 AI 信息索引，用来公开整理工具、产品、文章、行业标准与点子。

当前已完成 **M4 全量内容迁移与页面数据化**：20 个条目全部由 `content/entries/*.md` 唯一描述，首页、搜索、分类入口和通用详情页只读取生成 JSON；CLI 可以通过 `gh auth` 完成单条目的完整 CRUD 与查询。

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
```

## 项目文档

- [内容维护 Roadmap](docs/content-maintenance-roadmap.md)
- [M0 工程基线](docs/m0-engineering-baseline.md)
- [M1 首个条目纵向切片](docs/m1-vertical-slice.md)
- [M2 只读 CLI 与查询语义](docs/m2-readonly-cli.md)
- [M3 受控写入与并发保护](docs/m3-controlled-writes.md)
- [M4 全量迁移与页面数据化](docs/m4-full-migration.md)
- [产品定义](PRODUCT.md)
- [设计规范](DESIGN.md)

下一阶段 M5 将硬化 GitHub Actions、生成产物一致性与静态资源检查。
