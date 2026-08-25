let categories = [];
let allCategories = [];
const categoryIds = ["toolkit", "products", "articles", "standards", "ideas"];

const translations = {
  zh: {
    skipLink: "跳到主要内容",
    headerAria: "站点页头",
    homeAria: "AI Index 首页",
    indexAria: "AI Index 分类",
    searchLabel: "搜索 AI Index",
    searchPlaceholder: "搜索标题或描述",
    clearSearch: "清除搜索",
    results: "搜索结果",
    empty: "没有匹配的条目。",
    resultUnit: "条",
    showAllResults: "查看全部 {count} 条结果",
    ratingLegend: "评分：夯 > 人上人 > NPC",
    viewAll: "查看全部",
    viewAllAria: "查看全部内容",
    unrated: "未评分",
    languageAria: "Switch interface to English",
    itemsLabel: "条内容",
    backToCategory: "返回工具箱",
    myTake: "我的判断",
    relatedLinks: "相关资料",
    archiveId: "档案编号",
    categoryLabel: "分类",
    tagsLabel: "标签",
    addedAtLabel: "录入时间",
    linkCountLabel: "链接数量",
    topRated: "最高评级",
    referencesUnit: "个资料链接",
    toolkitLabel: "工具箱",
    standardsLabel: "标准",
    entryMetadataAria: "条目元信息",
    ratingAria: "评分：夯",
    sortLabel: "排序",
    tagFilterLabel: "标签筛选",
    timeFilterLabel: "时间筛选",
    sortRating: "评分优先",
    sortAdded: "最新录入",
    allTags: "全部标签",
    allTime: "全部时间",
    last7Days: "最近 7 天",
    last30Days: "最近 30 天",
    lastYear: "最近一年",
    categoryEmpty: "没有符合筛选条件的内容。",
  },
  en: {
    skipLink: "Skip to main content",
    headerAria: "Site header",
    homeAria: "AI Index home",
    indexAria: "AI Index categories",
    searchLabel: "Search AI Index",
    searchPlaceholder: "Search titles or descriptions",
    clearSearch: "Clear search",
    results: "Search results",
    empty: "No matching entries.",
    resultUnit: "results",
    showAllResults: "View all {count} results",
    ratingLegend: "RATING: 夯 > 人上人 > NPC",
    viewAll: "View all",
    viewAllAria: "View all entries",
    unrated: "Unrated",
    languageAria: "将界面切换为中文",
    itemsLabel: "items",
    backToCategory: "Back to Toolkit",
    myTake: "My take",
    relatedLinks: "References",
    archiveId: "Archive ID",
    categoryLabel: "Categories",
    tagsLabel: "Tags",
    addedAtLabel: "Added",
    linkCountLabel: "Links",
    topRated: "Top rated",
    referencesUnit: "references",
    toolkitLabel: "Toolkit",
    standardsLabel: "Standards",
    entryMetadataAria: "Entry metadata",
    ratingAria: "Rating: 夯",
    sortLabel: "Sort",
    tagFilterLabel: "Filter by tag",
    timeFilterLabel: "Filter by time",
    sortRating: "Rating first",
    sortAdded: "Recently added",
    allTags: "All tags",
    allTime: "All time",
    last7Days: "Last 7 days",
    last30Days: "Last 30 days",
    lastYear: "Last year",
    categoryEmpty: "No entries match these filters.",
  },
};

const state = {
  language: "zh",
  query: "",
  showAllSearchResults: false,
  selectedCategory: null,
  categorySort: "rating",
  categoryTag: "",
  categoryTime: "all",
};
let currentDetailEntry = null;

const categoryStack = document.querySelector("#category-stack");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const searchClear = document.querySelector("#search-clear");
const searchResults = document.querySelector("#search-results");
const resultList = document.querySelector("#result-list");
const resultCount = document.querySelector("#result-count");
const searchEmpty = document.querySelector("#search-empty");
const searchMore = document.querySelector("#search-more");
const languageSwitch = document.querySelector("#language-switch");
const categoryControls = document.querySelector("#category-controls");
const categorySort = document.querySelector("#category-sort");
const categoryTag = document.querySelector("#category-tag");
const categoryTime = document.querySelector("#category-time");
const ratingLegend = document.querySelector(".rating-legend");

/**
 * 将 Agent 可维护的文本转换为只表达文字的 HTML。
 *
 * 为什么存在：当前数据写在本地，未来会由受限 Agent 工具写入；渲染层不能把标题或描述解释为标签。
 * 数据如何流动：任何进入 innerHTML 模板的可变文本都先经过本函数，再成为页面文本节点。
 * 何时失败：null 或 undefined 会被转换为空字符串，页面保持可用。
 * 如何排查：检查所有模板插值是否经过 escapeHtml，尤其是标题、描述和分类名。
 * 什么不能改：不能因为写入端已鉴权就删除转义；鉴权不等于内容天然安全。
 */
function escapeHtml(value) {
  const entities = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };

  return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character]);
}

/**
 * 把条目链接限制为站内锚点或 HTTPS 地址。
 *
 * 为什么存在：链接由内容数据驱动，渲染层必须阻断 javascript: 等可执行协议。
 * 数据如何流动：原始 url 经过格式和协议校验后写入 href；无效值回落到当前条目的安全锚点。
 * 何时失败：URL 无法解析、不是 HTTPS、或锚点含异常字符时回落为 #main-content。
 * 如何排查：检查内容数据中的 url 是否为完整 HTTPS 地址或仅含小写字母、数字、连字符的锚点。
 * 什么不能改：不能允许 data:、javascript: 或由页面字符串拼接出的未知协议。
 */
function safeHref(value) {
  const candidate = String(value ?? "");
  if (/^#[a-z0-9-]+$/i.test(candidate)) return candidate;
  if (/^\.\/[a-z0-9-]+\.html(?:\?[a-z0-9=&_-]+)?$/i.test(candidate)) return candidate;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "https:") return parsed.href;
  } catch {
    return "#main-content";
  }

  return "#main-content";
}

/**
 * 从内容构建产物加载首页读模型。
 *
 * 为什么存在：M4 页面不能保留任何条目常量，首页、分类入口与搜索必须完全消费二十份 Markdown 的公开投影。
 * 数据如何流动：请求 data/index.json，验证五个固定分类及顺序；若 URL 带合法 category 只保留该分类，后续渲染与搜索只读取 categories。
 * 何时失败：网络、JSON 或结构异常会抛错并在初始化入口显示失败，避免悄悄展示过期样例。
 * 如何排查：先访问 ./data/index.json，再运行 npm run build:content 检查生成日志。
 * 什么不能改：不能在 fetch 失败时注入演示数据，也不能允许未知 category 静默显示全站内容。
 */
async function loadGeneratedIndex() {
  const response = await fetch("./data/index.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`index data returned ${response.status}`);
  const payload = await response.json();
  if (
    !payload ||
    !Array.isArray(payload.categories) ||
    payload.categories.length !== categoryIds.length ||
    payload.categories.some((category, index) => category.id !== categoryIds[index])
  ) {
    throw new Error("index data has invalid categories");
  }
  const selectedCategory = new URLSearchParams(window.location.search).get("category");
  if (selectedCategory && !categoryIds.includes(selectedCategory)) {
    throw new Error("invalid category id");
  }
  allCategories = payload.categories;
  state.selectedCategory = selectedCategory;
  categories = selectedCategory
    ? allCategories.filter((category) => category.id === selectedCategory)
    : allCategories;
}

/**
 * 按 URL 中不可变 ID 加载详情读模型。
 *
 * 为什么存在：通用 detail.html 不能保留 MCP Inspector 的标题、判断和链接副本，每个字段都必须来自对应公开 JSON。
 * 数据如何流动：查询参数只接受 kebab-case ID，随后 fetch data/entries/<id>.json 并保存到 currentDetailEntry。
 * 何时失败：ID 缺失、格式异常、条目回收或文件不存在时抛错，详情页不会渲染伪造路径。
 * 如何排查：检查地址栏 id、data/entries 文件和 GitHub Actions 内容构建日志。
 * 什么不能改：不能允许路径分隔符、相对路径或用标题猜测文件名。
 */
async function loadGeneratedDetail() {
  if (!document.body.classList.contains("detail-body")) return;
  const id = new URLSearchParams(window.location.search).get("id") ?? "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("invalid detail id");
  const response = await fetch(`./data/entries/${encodeURIComponent(id)}.json`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`detail data returned ${response.status}`);
  currentDetailEntry = await response.json();
}

function formatEditorialDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const months = [
    "JAN.",
    "FEB.",
    "MAR.",
    "APR.",
    "MAY",
    "JUN.",
    "JUL.",
    "AUG.",
    "SEP.",
    "OCT.",
    "NOV.",
    "DEC.",
  ];
  return `${months[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, "0")}, ${date.getUTCFullYear()}`;
}

/**
 * 把单条公开 JSON 填入既有报纸档案结构，不重建视觉 DOM。
 *
 * 为什么存在：详情视觉已经冻结，只应替换内容节点；整页模板重绘会让纸张、盒沿和响应式结构产生无关回归。
 * 数据如何流动：currentDetailEntry 的文本通过 textContent，链接通过 safeHref，唯一 HTML 字段使用构建期白名单 Markdown 产物。
 * 何时失败：必要节点缺失时保持空白并由浏览器检查暴露；初始化捕获数据加载失败并给出控制台错误。
 * 如何排查：对照 data/entries/<id>.json 检查节点 ID，不要在 HTML 中补写内容常量。
 * 什么不能改：personalTakeHtml 只能来自内容构建器；不能把任意 API HTML 直接放入 innerHTML。
 */
function renderDetailEntry() {
  if (!currentDetailEntry) return;
  const entry = currentDetailEntry;
  const categoryLabel = state.language === "zh" ? entry.categoryLabelZh : entry.categoryLabel;
  const addedDate = new Date(entry.addedAt);
  const compactDate = Number.isNaN(addedDate.getTime())
    ? ""
    : addedDate.toISOString().slice(0, 10).replaceAll("-", ".");

  document.title = `${entry.title} · AI Index`;
  const description = document.querySelector('meta[name="description"]');
  description?.setAttribute("content", `${entry.title} - AI Index entry.`);
  document.querySelector("#entry-title").textContent = entry.title;
  document.querySelector("#entry-summary").textContent = entry.summary;
  document.querySelector("#detail-folio-code").textContent = `AI INDEX / PERSONAL FILE ${entry.folioNumber}`;
  const folioDate = document.querySelector("#detail-folio-date");
  folioDate.textContent = formatEditorialDate(entry.addedAt);
  folioDate.setAttribute("datetime", entry.addedAt.slice(0, 10));
  document.querySelector("#entry-archive-code").textContent = entry.archiveCode;
  const tags = document.querySelector("#entry-tags");
  tags.textContent = entry.tags.join(" · ").toLocaleUpperCase();
  tags.closest("div").hidden = entry.tags.length === 0;
  const addedAt = document.querySelector("#entry-added-at");
  addedAt.textContent = compactDate;
  addedAt.setAttribute("datetime", entry.addedAt.slice(0, 10));
  const linkCount = entry.references.length + (entry.source ? 1 : 0);
  const linkCountNode = document.querySelector("#entry-link-count");
  linkCountNode.textContent = String(linkCount).padStart(2, "0");
  linkCountNode.closest("div").hidden = linkCount === 0;

  const category = document.querySelector("#entry-category");
  category.innerHTML = `<a href="./?category=${escapeHtml(entry.category)}">${escapeHtml(categoryLabel)}</a>`;
  const back = document.querySelector(".dossier__back");
  back.setAttribute("href", `./?category=${encodeURIComponent(entry.category)}`);
  back.querySelector("[data-i18n]").textContent =
    state.language === "zh" ? `返回${categoryLabel}` : `Back to ${categoryLabel}`;

  const rating = document.querySelector("#entry-rating");
  rating.hidden = !entry.rating;
  rating.querySelector("strong").textContent = entry.rating ?? "";
  rating.setAttribute(
    "aria-label",
    `${state.language === "zh" ? "评分" : "Rating"}：${entry.rating ?? translations[state.language].unrated}`,
  );

  const personalTake = document.querySelector("#entry-personal-take");
  personalTake.innerHTML = entry.personalTakeHtml;
  document.querySelector(".editorial-heading").hidden = !entry.personalTakeHtml;
  personalTake.hidden = !entry.personalTakeHtml;

  const source = document.querySelector("#entry-primary-source");
  source.hidden = !entry.source;
  if (entry.source) {
    source.setAttribute("href", safeHref(entry.source.url));
    source.querySelector("strong").textContent =
      state.language === "zh" ? `打开 ${entry.source.title}` : `Open ${entry.source.title}`;
  }

  const references = document.querySelector("#entry-references");
  references.innerHTML = entry.references
    .map(
      (reference, index) => `
        <li>
          <a href="${escapeHtml(safeHref(reference.url))}">
            <b aria-hidden="true">${String(index + 1).padStart(2, "0")}</b>
            <span><strong>${escapeHtml(reference.title)}</strong><small>${escapeHtml(reference.description ?? "")}</small></span>
            <code>${escapeHtml(reference.domain)}</code>
            <span class="link-arrow" aria-hidden="true">↗</span>
          </a>
        </li>
      `,
    )
    .join("");
  document.querySelector(".references").hidden = entry.references.length === 0;
  document.querySelector(".dossier__content").hidden =
    !entry.personalTakeHtml && !entry.source && entry.references.length === 0;
}

/**
 * 将评分文本映射为稳定的视觉等级。
 *
 * 为什么存在：评分中文文案是内容数据，CSS 类名必须稳定且不能依赖字符编码。
 * 数据如何流动：条目评分进入本函数，返回仅用于样式的等级名。
 * 何时失败：遇到未知评分时回落到 base，页面仍可读但不会获得高等级强调。
 * 如何排查：检查数据中的 rating 是否严格为“夯 / 人上人 / NPC”。
 * 什么不能改：不能用数组位置推断等级；未来排序或未评分条目会破坏这种隐式关系。
 */
function ratingClass(rating) {
  if (rating === "夯") return "top";
  if (rating === "人上人") return "high";
  return "base";
}

/**
 * 从完整分类数据中计算首页 Top 3。
 *
 * 为什么存在：首页不能依赖录入数组的偶然顺序，必须按“夯 > 人上人 > NPC”，同级按录入时间倒序。
 * 数据如何流动：完整 entries 先排除未评分，再复制、排序并截取三条，原数据顺序不会被修改。
 * 何时失败：缺失或无效日期会被视为最早时间；评分不在限定集合中的条目不进入首页。
 * 如何排查：检查 rating 是否为限定值、addedAt 是否为 ISO 时间，并比较排序后的前三项。
 * 什么不能改：未评分内容绝不能为了凑满三条而进入首页。
 */
function selectTopEntries(entries) {
  const priority = {
    夯: 3,
    人上人: 2,
    NPC: 1,
  };

  return entries
    .filter((entry) => priority[entry.rating])
    .slice()
    .sort((left, right) => {
      const ratingDelta = priority[right.rating] - priority[left.rating];
      if (ratingDelta !== 0) return ratingDelta;

      const rightTime = Number.isNaN(Date.parse(right.addedAt)) ? 0 : Date.parse(right.addedAt);
      const leftTime = Number.isNaN(Date.parse(left.addedAt)) ? 0 : Date.parse(left.addedAt);
      return rightTime - leftTime;
    })
    .slice(0, 3);
}

/**
 * 对分类页完整条目应用单标签、固定时间范围和显式排序。
 *
 * 为什么存在：首页只负责 Top 3；分类页必须展示全部内容，并按已确认的单标签、录入时间范围与两种排序组合筛选。
 * 数据如何流动：原 entries 先按选中 tag 与 addedAt cutoff 过滤，再复制排序；rating 使用相同等级顺序，added_at 直接按时间倒序。
 * 何时失败：异常 addedAt 会落到排序末尾且不命中有限时间范围；未知筛选值由控件白名单阻止。
 * 如何排查：比较 state 三个筛选值、当前时间和条目 tags/addedAt；搜索结果不经过本函数。
 * 什么不能改：不能支持多标签 AND、自定义日期、updatedAt 或语义筛选，也不能让首页 Top 3 受分类页筛选影响。
 */
function filterCategoryEntries(entries) {
  const rangeDays = { "7": 7, "30": 30, "365": 365 };
  const cutoff = rangeDays[state.categoryTime]
    ? Date.now() - rangeDays[state.categoryTime] * 24 * 60 * 60 * 1000
    : null;
  const filtered = entries
    .filter(
      (entry) =>
        !state.categoryTag || (Array.isArray(entry.tags) && entry.tags.includes(state.categoryTag)),
    )
    .filter((entry) => cutoff === null || Date.parse(entry.addedAt) >= cutoff)
    .slice();

  if (state.categorySort === "added_at") {
    return filtered.sort((left, right) => Date.parse(right.addedAt) - Date.parse(left.addedAt));
  }
  const priority = { 夯: 3, 人上人: 2, NPC: 1 };
  return filtered.sort((left, right) => {
    const ratingDelta = (priority[right.rating] ?? 0) - (priority[left.rating] ?? 0);
    return ratingDelta || Date.parse(right.addedAt) - Date.parse(left.addedAt);
  });
}

/**
 * 从当前分类数据构建紧凑筛选控件，并保持界面语言与选择状态。
 *
 * 为什么存在：标签动态来自事实源，不能写死 option；首页又不应展示只对分类页有意义的筛选栏。
 * 数据如何流动：选中分类的 tags 去重排序后生成单选列表，排序/时间使用固定白名单文案；现有 state 回填 select 并控制评分说明显隐。
 * 何时失败：分类没有标签时标签 select 禁用但保留“全部标签”；不存在的旧 tag 自动回到全部。
 * 如何排查：检查 category data 的 tags 与 state.categoryTag；切换语言只重建 option 文案，不修改内容。
 * 什么不能改：不能增加独立标签词表、多标签控件、自定义日期输入，或在首页显示分类筛选。
 */
function renderCategoryControls() {
  if (!categoryControls || !categorySort || !categoryTag || !categoryTime || !ratingLegend) return;

  const active = Boolean(state.selectedCategory && categories[0]);
  categoryControls.hidden = !active;
  ratingLegend.hidden = active;
  if (!active) return;

  const copy = translations[state.language];
  const tags = [
    ...new Set(
      categories[0].entries.flatMap((entry) => (Array.isArray(entry.tags) ? entry.tags : [])),
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (state.categoryTag && !tags.includes(state.categoryTag)) state.categoryTag = "";
  categorySort.innerHTML = `
    <option value="rating">${escapeHtml(copy.sortRating)}</option>
    <option value="added_at">${escapeHtml(copy.sortAdded)}</option>
  `;
  categoryTag.innerHTML = `
    <option value="">${escapeHtml(copy.allTags)}</option>
    ${tags.map((tag) => `<option value="${escapeHtml(tag)}"># ${escapeHtml(tag)}</option>`).join("")}
  `;
  categoryTime.innerHTML = `
    <option value="all">${escapeHtml(copy.allTime)}</option>
    <option value="7">${escapeHtml(copy.last7Days)}</option>
    <option value="30">${escapeHtml(copy.last30Days)}</option>
    <option value="365">${escapeHtml(copy.lastYear)}</option>
  `;
  categorySort.value = state.categorySort;
  categoryTag.value = state.categoryTag;
  categoryTag.disabled = tags.length === 0;
  categoryTime.value = state.categoryTime;
}

/**
 * 生成首页第一期五个分类的语义结构。
 *
 * 为什么存在：首页只展示每类评分最高的三条，分类顺序和数量必须由同一份数据驱动。
 * 数据如何流动：读取 categories 与当前界面语言，写入 categoryStack；所有分类共享同一左右基准线，条目正文始终保持原语言。
 * 何时失败：缺少容器时会直接返回，避免脚本阻断搜索和语言切换之外的页面。
 * 如何排查：检查 #category-stack、分类 id，以及 selectTopEntries 是否为每类返回最多三条。
 * 什么不能改：Ideas 必须保持最后一项，且不能在这里添加运营模块或额外一级分类。
 */
function renderCategories() {
  if (!categoryStack) return;

  categoryStack.innerHTML = categories
    .map((category, categoryIndex) => {
      const visibleLabel = state.language === "zh" ? category.labelZh : category.label;
      const archiveIndex = categoryIds.indexOf(category.id);
      const visibleEntries = state.selectedCategory
        ? filterCategoryEntries(category.entries)
        : selectTopEntries(category.entries);
      const tracks = visibleEntries
        .map(
          (entry) => {
            const ratingLabel = entry.rating ?? translations[state.language].unrated;
            return `
            <li class="track" id="${escapeHtml(category.id)}-${escapeHtml(entry.id)}">
              <a class="track__link" href="${escapeHtml(safeHref(entry.url))}">
                <span class="rating rating--${ratingClass(entry.rating)}">${escapeHtml(ratingLabel)}</span>
                <span class="track__title">${escapeHtml(entry.title)}</span>
                <span class="track__description">${escapeHtml(entry.description)}</span>
              </a>
            </li>
          `;
          },
        )
        .join("");
      const trackList =
        tracks || `<li class="category-empty">${escapeHtml(translations[state.language].categoryEmpty)}</li>`;

      return `
        <section
          class="sleeve"
          id="${escapeHtml(category.id)}"
          style="--order: ${categoryIndex}"
          aria-labelledby="${escapeHtml(category.id)}-title"
        >
          <span class="sleeve__top-shadow" aria-hidden="true"></span>
          <span class="sleeve__surface" aria-hidden="true"></span>
          <header class="sleeve__identity">
            <div class="sleeve__titleline">
              <h2 id="${escapeHtml(category.id)}-title">${escapeHtml(visibleLabel)}</h2>
              <span class="sleeve__count" aria-label="${state.selectedCategory ? visibleEntries.length : category.entries.length} ${translations[state.language].itemsLabel}">
                / ${String(state.selectedCategory ? visibleEntries.length : category.entries.length).padStart(2, "0")}
              </span>
            </div>
            <span class="sleeve__code" aria-hidden="true">
              AI-IX / ${category.label.toUpperCase()} / ${String(archiveIndex + 1).padStart(3, "0")}
            </span>
            <a
              class="sleeve__all"
              href="?category=${escapeHtml(category.id)}"
              ${state.selectedCategory ? "hidden" : ""}
              aria-label="${escapeHtml(translations[state.language].viewAllAria)}：${escapeHtml(visibleLabel)}"
            >
              <span>${escapeHtml(translations[state.language].viewAll)}</span>
              <svg viewBox="0 0 28 8" aria-hidden="true">
                <path d="M0 4h25M21 1l4 3-4 3"></path>
              </svg>
            </a>
          </header>
          <ol class="track-list">
            ${trackList}
          </ol>
        </section>
      `;
    })
    .join("");
}

/**
 * 按产品约定计算站内搜索相关度。
 *
 * 为什么存在：搜索只允许匹配标题和一句话描述，并按“标题精确 > 标题包含 > 描述包含”排序。
 * 数据如何流动：标准化查询与条目文本后返回数字分值，0 表示不展示。
 * 何时失败：空查询或不存在的字段会返回 0，不会抛错。
 * 如何排查：在控制台比较标准化后的 title、description 与 query。
 * 什么不能改：正文、分类名、评分和标签不能参与匹配，否则会偏离已经确认的搜索边界。
 */
function relevanceScore(entry, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return 0;

  const title = entry.title.toLocaleLowerCase();
  const description = entry.description.toLocaleLowerCase();

  if (title === normalizedQuery) return 300;
  if (title.includes(normalizedQuery)) return 200;
  if (description.includes(normalizedQuery)) return 100;
  return 0;
}

/**
 * 更新搜索结果层及其无障碍状态。
 *
 * 为什么存在：结果必须随着输入即时变化，同时让屏幕阅读器获得展开状态和数量反馈。
 * 数据如何流动：state.query 经过 relevanceScore 处理后写入结果列表、数量和空状态；首屏最多展示八条，用户可显式展开全部。
 * 何时失败：结果容器缺失时停止更新；主分类内容不受影响。
 * 如何排查：检查 input 的 aria-controls 与 #search-results / #result-list 是否一致。
 * 什么不能改：不要让搜索修改或重排首页分类；八条预览只用于控制浮层密度，不能截断实际结果总数。
 */
function renderSearchResults() {
  if (!searchResults || !resultList) return;

  const query = state.query.trim();
  const allEntries = allCategories.flatMap((category) => category.entries);
  const matches = allEntries
    .map((entry) => ({ entry, score: relevanceScore(entry, query) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
  const visibleMatches = state.showAllSearchResults ? matches : matches.slice(0, 8);

  const shouldOpen = query.length > 0;
  searchResults.hidden = !shouldOpen;
  searchInput.setAttribute("aria-expanded", String(shouldOpen));
  searchClear.hidden = !shouldOpen;

  if (!shouldOpen) {
    resultList.innerHTML = "";
    resultCount.textContent = "";
    searchMore.hidden = true;
    return;
  }

  resultCount.textContent = `${matches.length} ${translations[state.language].resultUnit}`;
  searchEmpty.hidden = matches.length !== 0;
  resultList.innerHTML = visibleMatches
    .map(({ entry }) => {
      const ratingLabel = entry.rating ?? translations[state.language].unrated;
      return `
        <li class="search-result">
          <a href="${escapeHtml(safeHref(entry.url))}">
            <span class="rating rating--${ratingClass(entry.rating)}">${escapeHtml(ratingLabel)}</span>
            <span class="search-result__title">${escapeHtml(entry.title)}</span>
            <span class="search-result__description">${escapeHtml(entry.description)}</span>
          </a>
        </li>
      `;
    })
    .join("");

  const hasMoreResults = matches.length > visibleMatches.length;
  searchMore.hidden = !hasMoreResults;
  searchMore.textContent = translations[state.language].showAllResults.replace("{count}", matches.length);
}

/**
 * 切换界面语言，但保持用户收藏内容的原始语言。
 *
 * 为什么存在：产品只承诺 UI 中英文切换，不自动翻译条目内容。
 * 数据如何流动：state.language 更新根语言、静态界面文案、分类标签和搜索结果。
 * 何时失败：未知翻译键保持原文本，因此页面不会出现空白控件。
 * 如何排查：检查 data-i18n / data-i18n-aria 是否存在对应 translations 键。
 * 什么不能改：entry.title 与 entry.description 不能在这里翻译。
 */
function applyLanguage() {
  const copy = translations[state.language];
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (copy[key]) element.textContent = copy[key];
  });

  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    const key = element.dataset.i18nAria;
    if (copy[key]) element.setAttribute("aria-label", copy[key]);
  });

  searchInput.placeholder = copy.searchPlaceholder;
  languageSwitch.setAttribute("aria-label", copy.languageAria);
  languageSwitch.innerHTML =
    state.language === "zh"
      ? '<span class="language-switch__muted">中</span><span aria-hidden="true">/</span><span class="language-switch__active">EN</span>'
      : '<span class="language-switch__active">中</span><span aria-hidden="true">/</span><span class="language-switch__muted">EN</span>';

  renderCategoryControls();
  renderCategories();
  renderSearchResults();
  renderDetailEntry();
}

searchInput?.addEventListener("input", (event) => {
  state.query = event.currentTarget.value;
  state.showAllSearchResults = false;
  renderSearchResults();
});

searchInput?.addEventListener("focus", () => {
  if (state.query) renderSearchResults();
});

searchInput?.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.query) {
    state.query = "";
    searchInput.value = "";
    renderSearchResults();
  }
});

searchClear?.addEventListener("click", () => {
  state.query = "";
  state.showAllSearchResults = false;
  searchInput.value = "";
  renderSearchResults();
  searchInput.focus();
});

searchMore?.addEventListener("click", () => {
  state.showAllSearchResults = true;
  renderSearchResults();
  resultList.querySelector("a")?.focus();
});

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  resultList.querySelector("a")?.focus();
});

languageSwitch?.addEventListener("click", () => {
  state.language = state.language === "zh" ? "en" : "zh";
  applyLanguage();
});

categorySort?.addEventListener("change", (event) => {
  state.categorySort = event.currentTarget.value;
  renderCategories();
});

categoryTag?.addEventListener("change", (event) => {
  state.categoryTag = event.currentTarget.value;
  renderCategories();
});

categoryTime?.addEventListener("change", (event) => {
  state.categoryTime = event.currentTarget.value;
  renderCategories();
});

document.addEventListener("click", (event) => {
  if (!searchResults.contains(event.target) && !searchForm.contains(event.target) && state.query) {
    searchResults.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
  }
});

/**
 * 在首次渲染前同时取得首页和可选详情数据。
 *
 * 为什么存在：如果先渲染空壳再异步替换，会出现错误计数、搜索遗漏和详情硬编码闪烁。
 * 数据如何流动：首页读模型始终加载；详情页额外加载当前 ID，全部成功后统一应用语言并渲染。
 * 何时失败：任一公开 JSON 不可用时记录错误，并在详情标题或首页分类区显示明确失败文案。
 * 如何排查：直接访问对应 JSON，随后运行内容构建与 Vite 服务；浏览器控制台保留原始异常。
 * 什么不能改：不能用 app.js 中的 MCP Inspector 常量兜底，那会破坏 Markdown 唯一事实源。
 */
async function initializeApplication() {
  try {
    await Promise.all([loadGeneratedIndex(), loadGeneratedDetail()]);
    applyLanguage();
  } catch (error) {
    console.error("AI Index data initialization failed", error);
    if (document.body.classList.contains("detail-body")) {
      const title = document.querySelector("#entry-title");
      if (title) title.textContent = state.language === "zh" ? "条目加载失败" : "Entry unavailable";
    } else if (categoryStack) {
      categoryStack.innerHTML = `<p>${escapeHtml(state.language === "zh" ? "内容加载失败。" : "Content unavailable.")}</p>`;
    }
  }
}

void initializeApplication();
