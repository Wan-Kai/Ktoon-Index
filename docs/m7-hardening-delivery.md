# M7 硬化与交付证据

M7 完成内容维护第一阶段的安全硬化、真实远端验证、页面回归和维护交接。本文件记录可复查的证据；日常操作与故障恢复见 [维护者指南](./maintainer-guide.md)。

## 稳定契约与安全边界

- 对外错误码固定为 `VALIDATION_FAILED`、`NOT_FOUND`、`ID_CONFLICT`、`VERSION_CONFLICT`、`AUTH_REQUIRED`、`FORBIDDEN`、`GITHUB_ERROR`、`BUILD_FAILED`，自动化测试检查集合完全相等。
- Frontmatter 只接受 Entry Schema 已知字段，额外字段不会被静默保存。
- 标签拒绝控制字符、双向文本控制符、零宽格式字符和孤立代理项。
- 测试覆盖 Frontmatter 注入、危险协议、原始 HTML、异常 Unicode 标签、损坏 JSON，以及损坏输入不会触发 GitHub 请求。
- Skill 仍只调用受控 CLI；元数据、仓库外定位、CRUD 命令和脱离仓库失败语义均有契约测试。

本地门禁结果：13 个测试文件、66 个测试全部通过；`npm run verify` 同时通过格式、类型、事实源生成、Vite 生产构建和发布包校验。发布包包含 20 个公开条目、20 个详情数据与 20 组引用。

## 真实 GitHub sandbox

集成脚本 `npm run verify:github-sandbox` 使用一次性远端分支和生产 `GitHubContentClient` 验证真实 GitHub API，不修改 `main`。2026-08-25 演练结果：

- 分支：`m7-sandbox-1dc50cf2`，完成后已删除；
- create request：`3c1211ca-1661-48ed-91b6-daebedfaef1f`；commit：`074a07ae26c1ffdf3096f13b88c4ba25ad1129e0`；
- update request：`9b1fc5fb-eb79-41ae-badb-fdcbafa754ae`；commit：`6d4707111b3832a146b3d26dd662eae4df0c195d`；
- create/update 原 request ID 重放均返回 `idempotent: true`，没有重复 commit；
- 过期 version/SHA 返回 `VERSION_CONFLICT`，失败前后分支 head 不变；
- 每个成功 commit 只修改一个条目，并包含 operation、entry ID、content version 与 request ID trailers；
- 当前认证身份对固定仓库可读写，临时分支清理成功。

## 页面回归

使用真实 Chrome 分别在 1440×900 和 390×844 CSS viewport 检查本地生产等价页面：

- 首页保留工具箱、产品、文章、标准、点子五类，每类展示评分最高三条；
- 字符串搜索 MCP Inspector 返回唯一匹配；工具箱标签 `mcp` 筛选返回唯一匹配；
- 首页、分类页和详情页均无横向溢出；
- MCP Inspector 详情包含来源入口、三条参考链接与个人判断；
- 切换英文后只改变界面文案，条目标题保持不变；
- 浏览器控制台没有 warning 或 error。

Pages 部署后再次使用 Chrome 抽检 `https://wan-kai.github.io/Ktoon-Index/`：线上首页包含五个分类和 15 条预览，MCP Inspector 详情可打开；两页均无横向溢出，控制台无 warning 或 error。

## 切换与恢复

切换前创建并推送 annotated tag `static-v1-before-m7`。tag 对象 `5eba11b0f8ea2391590be5a5c0eca45db5a1eff3` 指向已通过 M6 门禁的 commit `322fd05b73b3715ac7dc8fb4df897aea3e0f2db3`。

M7 主提交 `6f18d8779293b5083a17b3006ed902e15f31e25c` 的 [Verify and deploy run 32865516694](https://github.com/Wan-Kai/Ktoon-Index/actions/runs/32865516694) 已完成 build 与 Pages deploy。

恢复坚持普通 commit，不移动 tag、不 force-push，完整命令和失败处理见维护者指南。实际演练在一次性分支 `m7-restore-drill-20260825` 将完整工作树恢复到 tag，产生普通 commit `3940099f89752372d349b7541163fddbc292b0d2`，并手动触发 [workflow run 32865699554](https://github.com/Wan-Kai/Ktoon-Index/actions/runs/32865699554)。build 全部通过，非 `main` 分支的 deploy 按设计跳过；验证后远端和本地临时分支均已删除，生产 `main` 未改变。
