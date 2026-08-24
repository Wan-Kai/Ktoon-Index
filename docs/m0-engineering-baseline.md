# M0 工程基线

## 仓库

- GitHub repository：`Wan-Kai/Ktoon`
- Visibility：public
- Default branch：`main`
- Git protocol：HTTPS through existing `gh auth`
- 唯一维护者：`Wan-Kai`

## 工程

- Node.js：22.23.1
- npm：10.9.8
- Vue：3.5
- TypeScript：5.9
- Vite：7.3
- Vitest：3.2

Node 版本通过 `.nvmrc` 与 `package.json#engines` 固定；npm 版本通过 `packageManager` 固定。Prettier 只检查 M0 新增的 TypeScript、测试和工程 JSON，不格式化已经冻结的页面源文件。

现有页面继续由 `index.html`、`detail.html`、`app.js` 和两份 CSS 驱动。Vue/Vite 只建立后续数据化所需的工程入口，M0 没有改写运行时页面。

Vite 对现有经典脚本给出“不能 bundle 非 module script”的提示，这是迁移前的已知状态。构建插件会把 `app.js` 原样复制到 `dist`，因此产物保持可运行；M4 将页面迁移为 Vue 后删除兼容插件。

## 质量命令

```bash
npm test
npm run typecheck
npm run format:check
npm run build:content
npm run build
```

M0 验证结果：

- 3 个测试文件、7 个测试通过。
- 当前内容 fixture 会与 `app.js` 做完整数据比较；五个冻结源文件和六张浏览器截图都会校验 SHA-256，任何未确认的基线漂移都会使测试失败。
- TypeScript 类型检查通过。
- 内容构建入口返回有效 JSON，且明确 `generated: false`。
- Vite 多页面构建通过，`dist/index.html`、`dist/detail.html` 与 `dist/app.js` 均存在。
- 生产预览实测：首页渲染 5 个分类，搜索 `MCP Inspector` 返回 1 条结果，详情页标题正确，控制台无 error 或 warning。

## 内容基线

- 五个固定分类：toolkit、products、articles、standards、ideas。
- 每类当前包含三条已评分内容和一条未评分内容。
- 点子固定在最后。
- Fixture：`tests/fixtures/current-content.json`。

## 视觉基线

Chrome 实际验证首页和详情页：

- 1440 × 900
- 1024 × 900
- 390 × 844

六张截图均满足 `scrollWidth === clientWidth`。截图及 SHA-256 位于 `tests/baselines/`。

截图右侧偶尔出现的浏览器扩展悬浮按钮不属于站点 DOM，后续视觉对比应忽略该区域。

## 页面源文件冻结证据

M0 完成后，五个既有页面源文件 SHA-256 与开始前一致：

- `index.html`：`807decd77b3fd0e794f0e0f7def7e4ad9e359fe8ea5e073f1eb6b175b73e0200`
- `detail.html`：`91877822c91f47bdb1961b002a5f1959fc6efb2679c8398f4dfacd0ec65a0448`
- `app.js`：`dec7275dce85e516c51574559ad4d05dc70658ccfe8a83d037391f4574ec87b8`
- `styles.css`：`969036a00cb2832991d099c682514ab21f4942b91d5d15a2f158bc1b862a50d7`
- `detail.css`：`0f35eba4598e9d360f2293eaf8f91c6720ff29878fd583bcd8e428632e143542`
