import { AppError } from "./errors.ts";
import { normalizeTags, type CategoryId, type Entry, type Rating } from "./schema.ts";

export type EntrySort = "rating" | "added_at";
export type EntryQueryFilters = {
  category?: CategoryId;
  tags?: string[];
  rating?: Rating | null;
  addedAfter?: string;
  addedBefore?: string;
  sort?: EntrySort;
};

export type EntrySearchResult = {
  entry: Entry;
  score: number;
};

const ratingPriority: Record<Rating, number> = { 夯: 3, 人上人: 2, NPC: 1 };

function parseBoundary(value: string | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new AppError("VALIDATION_FAILED", `${field} 不是有效时间`, { field, value });
  }
  return timestamp;
}

/**
 * 以产品确认的分类、标签、评分和录入时间语义筛选条目。
 *
 * 为什么存在：CLI、内存测试 adapter 和未来页面筛选必须共享同一套规则，不能在每个入口重新解释参数。
 * 数据如何流动：标签先复用写入规范化；分类/评分精确匹配；多个标签采用 AND；时间边界包含端点；最后复制并稳定排序。
 * 何时失败：时间无法解析或标签规范化失败时抛出 VALIDATION_FAILED，不返回部分结果。
 * 如何排查：检查 added-after/before 是否为 ISO 或 YYYY-MM-DD，并核对规范化后的标签集合。
 * 什么不能改：评分不参与字符串搜索；这里也不能把未评分内容自动提升来补齐结果。
 */
export function filterEntries(entries: Entry[], filters: EntryQueryFilters = {}): Entry[] {
  const requiredTags = normalizeTags(filters.tags ?? []);
  const addedAfter = parseBoundary(filters.addedAfter, "added_after");
  const addedBefore = parseBoundary(filters.addedBefore, "added_before");
  const sort = filters.sort ?? "rating";

  return entries
    .filter((entry) => filters.category === undefined || entry.category === filters.category)
    .filter((entry) => filters.rating === undefined || entry.rating === filters.rating)
    .filter((entry) => requiredTags.every((tag) => entry.tags.includes(tag)))
    .filter((entry) => addedAfter === undefined || Date.parse(entry.addedAt) >= addedAfter)
    .filter((entry) => addedBefore === undefined || Date.parse(entry.addedAt) <= addedBefore)
    .slice()
    .sort((left, right) => {
      if (sort === "rating") {
        const ratingDelta =
          (right.rating ? ratingPriority[right.rating] : 0) -
          (left.rating ? ratingPriority[left.rating] : 0);
        if (ratingDelta !== 0) return ratingDelta;
      }
      const timeDelta = Date.parse(right.addedAt) - Date.parse(left.addedAt);
      if (timeDelta !== 0) return timeDelta;
      return left.title.localeCompare(right.title);
    });
}

/**
 * 只按标题和摘要进行字符串搜索并输出可解释相关度。
 *
 * 为什么存在：产品已经排除评分、分类、标签和正文搜索；纯函数可保证 GitHub 与内存数据源得到相同排序。
 * 数据如何流动：先应用结构化筛选，再把 NFKC/小写查询与标题、摘要比较，按标题精确 300、标题包含 200、摘要包含 100 计分。
 * 何时失败：空查询返回 VALIDATION_FAILED；字段已由 Entry Schema 保证为字符串。
 * 如何排查：检查 query 规范化结果和每条 score，确认没有误把评分或标签文本传进搜索字段。
 * 什么不能改：不能加入模糊向量、正文或评分权重；M2 明确采用字符串匹配与相关度排序。
 */
export function searchEntries(
  entries: Entry[],
  query: string,
  filters: EntryQueryFilters = {},
): EntrySearchResult[] {
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    throw new AppError("VALIDATION_FAILED", "搜索字符串不能为空");
  }

  return filterEntries(entries, filters)
    .map((entry) => {
      const title = entry.title.normalize("NFKC").toLocaleLowerCase();
      const summary = entry.summary.normalize("NFKC").toLocaleLowerCase();
      const score =
        title === normalizedQuery
          ? 300
          : title.includes(normalizedQuery)
            ? 200
            : summary.includes(normalizedQuery)
              ? 100
              : 0;
      return { entry, score };
    })
    .filter((result) => result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.entry.addedAt) - Date.parse(left.entry.addedAt) ||
        left.entry.title.localeCompare(right.entry.title),
    );
}

/**
 * 从条目动态枚举唯一标签。
 *
 * 为什么存在：产品不设标签管理模块，标签列表必须始终由当前条目推导。
 * 数据如何流动：读取已规范化标签，Set 去重后按 locale 稳定排序。
 * 何时失败：正常 Entry 不会失败；若出现空标签说明事实源绕过了 Schema，应停止构建而不是这里修补。
 * 如何排查：对异常条目重新运行 parseEntry，并检查 tags Frontmatter。
 * 什么不能改：不能维护额外固定词表，也不能统计评分、分类或正文中的相似词。
 */
export function listTags(entries: Entry[]): string[] {
  return [...new Set(entries.flatMap((entry) => entry.tags))].sort((left, right) =>
    left.localeCompare(right),
  );
}
