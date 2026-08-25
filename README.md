# Ktoon AI Index

Ktoon 的个人 AI 信息索引，用来公开整理工具、产品、文章、行业标准与点子。

当前已完成 **M1 首个条目纵向切片**：MCP Inspector 由 Markdown 唯一描述，本地 CLI 可以通过 `gh auth` 创建和读取条目，公开 JSON 驱动现有首页与详情页。其余 19 条内容将在 M4 全量迁移。

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
- [产品定义](PRODUCT.md)
- [设计规范](DESIGN.md)

下一阶段 M2 将补齐 list、search、tag list 与只读筛选语义。
