import { renderRestrictedMarkdown } from "./markdown.ts";
import type { CategoryId, Entry } from "./schema.ts";

export const CATEGORY_META: Record<
  CategoryId,
  { label: string; labelZh: string; archivePrefix: string }
> = {
  toolkit: { label: "Toolkit", labelZh: "工具箱", archivePrefix: "TOOLKIT" },
  products: { label: "Products", labelZh: "产品", archivePrefix: "PRODUCTS" },
  articles: { label: "Articles", labelZh: "文章", archivePrefix: "ARTICLES" },
  standards: { label: "Standards", labelZh: "标准", archivePrefix: "STANDARDS" },
  ideas: { label: "Ideas", labelZh: "点子", archivePrefix: "IDEAS" },
};

/** 从 HTTPS URL 提取页面展示需要的域名，不把解析职责留给浏览器模板。 */
function domainOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./u, "");
}

/**
 * 把维护侧 Entry 投影成公开详情 JSON，显式剔除版本与生命周期字段。
 *
 * 为什么存在：公开站不应泄漏 version、status、GitHub SHA、请求 ID 或维护者信息，读模型必须是单向白名单。
 * 数据如何流动：已校验 Entry 进入本函数，只挑选页面字段，并把 Markdown 渲染为安全 HTML、链接补充派生域名。
 * 何时失败：Markdown 或 URL 理论上已在入口校验；若这里失败说明事实源绕过了统一解析，构建必须中止。
 * 如何排查：先对对应 Markdown 运行 parseEntry，再检查是否有人直接构造 Entry。
 * 什么不能改：不能使用对象展开后删除少数字段；新增维护字段时会因此意外公开。
 */
export function projectPublicEntry(entry: Entry, ordinal = 1) {
  const meta = CATEGORY_META[entry.category];
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    category: entry.category,
    categoryLabel: meta.label,
    categoryLabelZh: meta.labelZh,
    archiveCode: `AI-IX / ${meta.archivePrefix} / ${String(ordinal).padStart(3, "0")}`,
    folioNumber: String(ordinal).padStart(3, "0"),
    tags: entry.tags,
    rating: entry.rating,
    addedAt: entry.addedAt,
    updatedAt: entry.updatedAt,
    personalTakeHtml: renderRestrictedMarkdown(entry.personalTake),
    source: entry.source
      ? { title: entry.source.title, url: entry.source.url, domain: domainOf(entry.source.url) }
      : null,
    references: entry.references.map((reference) => ({
      title: reference.title,
      url: reference.url,
      description: reference.description ?? null,
      domain: domainOf(reference.url),
    })),
  };
}

/** 生成首页条目所需的最小公开字段。 */
export function projectIndexEntry(entry: Entry) {
  return {
    id: entry.id,
    rating: entry.rating,
    addedAt: entry.addedAt,
    updatedAt: entry.updatedAt,
    title: entry.title,
    description: entry.summary,
    url: `./detail.html?id=${encodeURIComponent(entry.id)}`,
  };
}
