# M9 可发现性与分享基础

M9 不改变首页、详情页视觉和内容模型，只让公开站的页面身份、索引入口与分享摘要具备稳定契约。

## 已实现

- 首页源 HTML 声明绝对自指 canonical、完整 Open Graph、Twitter large image 与文字档案风 favicon。
- 复用已确认的首页视觉基线生成 1200×630 JPEG 分享图，不引入新的页面视觉或 Logo。
- 详情页源 HTML 不预置无 ID canonical；条目 JSON 成功加载后，使用不可变 `entry.id` 生成 canonical、`og:url`、标题和摘要。
- `build:content` 从 published Markdown 生成 `public/sitemap.xml`，首页 `lastmod` 取最新内容更新时间，详情页取各自 `updated_at`。
- `verify:release` 强制要求 `favicon.svg`、`robots.txt`、`sitemap.xml` 存在，并把 sitemap 与当前 Markdown 投影逐字比较。
- M9 契约测试覆盖首页 head、分享图尺寸、动态详情运行时去重与 query 隔离、sitemap URL 集合与回收语义，以及错误 robots/sitemap 的发布拒绝。

## 关键边界

- GitHub Pages 项目站只能发布在 `/Ktoon-Index/` 子路径，无法控制共享域名根路径 `/robots.txt`。仓库仍保留项目级 `robots.txt` 和 sitemap 声明，供直接访问、未来自定义域名或迁移托管时复用；当前搜索引擎发现的可靠入口是根 sitemap URL与站内链接。
- 多数搜索引擎可以渲染 JavaScript 后读取动态详情 canonical；部分社交抓取器不会执行 JavaScript，因此详情分享卡片可能只显示通用回退标题。彻底解决需要为每个条目构建独立 HTML URL或改用支持服务端渲染的托管，本阶段不引入这项复杂度。
- 分类和搜索参数只改变同一首页的浏览状态，不进入 sitemap，也不形成独立 canonical 页面。

## 验证结果

- 真实 Chrome 中 `mcp-inspector` 的 title、description、canonical、`og:url` 和 Twitter title 均与条目一致，canonical 数量为 1。
- 带 `?category=toolkit` 的首页 canonical 仍为站点根地址，控制台无 warning/error。
- 自动化门禁由 `tests/discoverability-contract.test.ts`、完整测试套件、Vite 生产构建和发布包校验共同承担。

参考规范：[Google canonical 指南](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)、[Google sitemap 指南](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[Open Graph protocol](https://ogp.me/)。
