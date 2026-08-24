# Homepage surface brief

- Product: AI Index
- Mode: Read
- Visual direction: Crate Index
- Direction approval: 用户选择方案 1（2026-08-11）
- Viewport for comps: desktop landscape
- Structure fixed: compact masthead/search, then six categories in the order Toolkit → Engineering → Standards → Products → Notes → Ideas
- Each category: category name, count, top 3 highest-rated items
- Item preview: rating, title, one-line description
- Homepage controls: search, language switch only
- Build preference: single column, extreme clarity, no decorative hero
- Approved composition: `.impeccable/mocks/home-a-continuous-sleeves.png`
- Composition approval: 用户选择 A，并要求增强实体感（2026-08-11）

## Composition uncertainty to test

1. 分类隔板是“连续抽屉”、独立纸套，还是中央目录脊。
2. 分类名称、数量和 Top 3 的视觉权重如何平衡。
3. 搜索是顶部工具条、箱体铭牌，还是贯穿页面的目录槽。

## Approved composition

采用 Continuous Sleeves。六张冷灰纸套连续叠放在哑光黑箱体中；每张纸套左侧是分类名和数量，右侧是评分最高的三条。搜索作为箱体上沿的目录槽。实体感来自真实纸张/压制板纹理、边缘高光、柔和接触阴影和轻微抽出反馈，不来自透视场景或把整页栅格化。

### Component grammar

- Corner language: 纸套 3–5px 钝角；小型控件可使用 999px 胶囊。
- Line weights: 内容分隔 1px；定位线 1px；箱体结构线 1–2px。
- Elevation: 纸套只用低位移柔和接触阴影；不同时叠加描边和宽阴影。
- Type ramp: 站名 48px；分类 56–80px 窄体；条目 16–18px；说明 14–16px；数据 12–14px 等宽。
- Responsive: 移动端仍为单列纸套；分类头移到顶部，条目变成两行布局，描述保持可读。

### Visible ingredient inventory

| Ingredient | Commitment | Medium | Status |
| --- | --- | --- | --- |
| Matte crate surface | 全页背景与箱体，微细压制板纤维 | Generated raster `assets/graphite-grain.webp` | Produce |
| Cool paper sleeves | 六个分类全覆盖，细纸纤维，不含光影 | Generated raster `assets/paper-grain.webp` | Produce |
| Sleeve stack and tabs | 六张连续重叠纸套、错位顶部标签 | Semantic HTML + CSS | Build |
| Catalog groove crop | 页头右上角 8–10 条同心细线 | Authored SVG/CSS geometry | Build |
| Search catalog slot | 页面主要交互；真实 input、清除和结果层 | Semantic HTML + authored SVG icon + JS | Build |
| Category and count | 左侧约 32%，大窄体名称 + 等宽数量 | Semantic HTML + self-hosted fonts | Build |
| Top 3 track list | 每类恰好三行；评分、标题、说明三段对齐 | Semantic HTML + CSS | Build |
| Rating stamps | 夯 / 人上人 / NPC，酸绿只强调最高等级 | Semantic HTML + CSS | Build |
| Stylus locator | hover/focus 时 1px 线与 4px 抽出 | CSS geometry and motion | Build |
| Language switch | 只切换界面文案，不翻译内容 | Semantic button + JS | Build |

### Must not be literalized

- 不绘制大型唱片、唱针、封面墙或真实桌面场景。
- 不把界面文字烘焙进图片。
- 不强求一屏看完；真实内容长度和移动端可读性优先于构图图的压缩密度。

