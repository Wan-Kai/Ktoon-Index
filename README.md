# Ktoon AI Index

Ktoon 的个人 AI 信息索引，用来公开整理工具、产品、文章、行业标准与点子。

当前处于 **M0 工程基线**：首页与详情页视觉已冻结，Vue 3、TypeScript、Vite、Vitest 和后续本地 CLI 的工程骨架已经建立；内容仍由现有 `app.js` 驱动，尚未迁移为 Markdown 事实源。

## 本地运行

```bash
npm install
npm run dev
```

默认访问 `http://127.0.0.1:5173/`。如端口被占用，以 Vite 输出为准。

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
- [产品定义](PRODUCT.md)
- [设计规范](DESIGN.md)

下一阶段 M1 将从本地 CLI 开始，用一条 Markdown 内容贯通校验、GitHub 提交、公开 JSON 和现有页面。
