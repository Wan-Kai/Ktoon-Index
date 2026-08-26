# M8 页面性能硬化

M8 在不扩展产品功能的前提下，用真实 Chrome 还原首页和详情页加载顺序，针对实际 LCP 资源完成优化，并把性能与视觉结果转成可持续回归的工程契约。

## 真实加载顺序

本地生产构建使用全新端口隔离浏览器缓存，页面内临时探针记录 Navigation Timing、Resource Timing、Paint、Largest Contentful Paint、Layout Shift 与 Long Task；探针采样后已移除，自动化测试阻止其进入发布版本。

首页冷启动顺序为：

```text
HTML
  → styles.css / app.js
  → 石墨纹理与首批字体
  → data/index.json
  → 分类卡片 DOM 渲染
  → 纸张纹理
  → LCP
```

Chrome 记录的首页 LCP 元素是 `.sleeve__surface`，对应 `paper-grain.webp`。优化前该资源要等数据返回并生成卡片后才由 CSS 发起，开始时间约 227ms，因此纹理而非 JavaScript 体积是本轮最有证据的优化目标。

## 优化结果

| 指标 | M7 基线 | M8 样本 | 变化 |
| --- | ---: | ---: | ---: |
| 纸张纹理文件 | 327,278 B | 66,526 B | -79.7% |
| 石墨纹理文件 | 441,774 B | 123,774 B | -72.0% |
| 两张纹理合计 | 769,052 B | 190,300 B | -75.3% |
| 首页 FCP | 92ms | 80ms | -13.0% |
| 首页 LCP | 372ms | 280ms | -24.7% |
| 首页 CLS | 0 | 0 | 持平 |
| 首页最大 Long Task | 0ms | 0ms | 持平 |
| 详情页 FCP | 132ms | 44ms | -66.7% |
| 详情页 LCP | 240ms | 140ms | -41.7% |
| 详情页 CLS | 0 | 0 | 持平 |
| 详情页最大 Long Task | 61ms | 52ms | -14.8% |

成对资源时序如下，数字均为相对 Navigation Start 的请求开始时间：

- 首页基线：`app.js/styles.css` 约 36ms，石墨纹理约 69ms，`data/index.json` 约 113ms，纸张纹理 227ms；
- 首页 M8：纸张纹理 35ms，`app.js/styles.css` 约 35ms，石墨纹理约 80ms，`data/index.json` 约 108ms；
- 详情页基线：`app.js/styles.css/detail.css` 约 54ms，两份 JSON 约 107–108ms，石墨纹理约 109ms，纸张纹理约 124ms；
- 详情页 M8：纸张纹理约 15ms，`app.js/styles.css/detail.css` 约 15ms，两份 JSON 约 42–43ms，石墨纹理约 43ms。

这些毫秒数据是本机 Chrome 的单次冷启动对比，用于定位与验证方向，不宣称等同于所有用户环境的线上分位数。详情页两次样本的 TTFB 分别约 44ms 和 10ms，FCP/LCP 降幅包含本地服务响应波动；确定性成果是资源字节减少、纸张纹理由延后请求变为与 CSS/脚本同时开始，以及构建产物中 preload 与 CSS 只请求同一带哈希文件。

## 实现与回归边界

- 两张纹理保持 1600×1600、相同色彩与实体材质方向，以 WebP quality 65 重新编码。
- 首页和详情页均在 `<head>` preload `paper-grain.webp`；Vite 将 preload 与 CSS URL 改写为同一内容哈希。
- `tests/performance-contract.test.ts` 解析 HTML 语义，校验纹理 RIFF/WEBP/VP8、尺寸、SHA-256、体积预算，并运行生产构建验证资源复用。
- 重新采集首页和详情页的 1440×900、1024×900、390×844 六张 Chrome 截图；所有视口均无横向溢出。
- 首页五分类与 15 条预览正常，MCP Inspector 详情的来源和三条参考链接正常，控制台无 warning/error。

## 发布证据

性能提交 `7a5fd02a6b137a739a09b77ebd7bb3b05be22bf9` 通过 14 个测试文件、70 项测试，以及格式、类型、内容、生产构建和发布包校验。[Verify and deploy run 32926345099](https://github.com/Wan-Kai/Ktoon-Index/actions/runs/32926345099) 完成 Pages 部署；线上首页加载唯一带哈希纸张纹理 `paper-grain-SHB1qd10.webp`，15 条预览正常且控制台无错误。

独立评审检查了 preload 复用、纹理可解码性、尺寸、实体质感、六张视觉基线和性能预算，最终结论为 PASS，0 个阻塞项。
