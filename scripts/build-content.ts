import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CATEGORY_IDS,
  CATEGORY_META,
  AppError,
  filterEntries,
  parseEntry,
  projectIndexEntry,
  projectPublicEntry,
  type Entry,
} from "../src/content/index.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentDirectory = resolve(projectRoot, "content/entries");
const dataDirectory = resolve(projectRoot, "data");
const publicDirectory = resolve(projectRoot, "public");
export const SITE_URL = "https://wan-kai.github.io/Ktoon-Index/";

export function buildRobots(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * 从 published 条目生成与公开详情 URL 一致的 XML sitemap。
 *
 * 为什么存在：站点内容由 Markdown 动态投影，手工 sitemap 会在回收、恢复或新增条目后产生幽灵 URL。
 * 数据如何流动：仅 published Entry 进入结果；首页使用最新一次内容更新时间，详情页使用各自 updatedAt，并输出绝对 canonical URL。
 * 何时失败：调用方必须先完成 Entry 校验；本函数只做确定性序列化，不读取文件系统。
 * 如何排查：比较 sitemap 中的 ID、lastmod 与对应 `content/entries/*.md`，再检查 SITE_URL 是否仍为真实发布根地址。
 * 什么不能改：不能纳入 recycled 条目、分类筛选参数或相对 URL；这些 URL 会与公开读模型和 canonical 信号冲突。
 */
export function buildSitemap(entries: Entry[]): string {
  const published = entries.filter((entry) => entry.status === "published");
  const latestUpdate = published
    .map((entry) => entry.updatedAt)
    .sort((left, right) => right.localeCompare(left))[0];
  const urls: Array<{ location: string; lastModified?: string }> = [
    { location: SITE_URL, lastModified: latestUpdate },
    ...published
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entry) => ({
        location: `${SITE_URL}detail.html?id=${encodeURIComponent(entry.id)}`,
        lastModified: entry.updatedAt,
      })),
  ];
  const body = urls
    .map(({ location, lastModified }) => {
      const lastModifiedElement = lastModified
        ? `\n    <lastmod>${escapeXml(lastModified.slice(0, 10))}</lastmod>`
        : "";
      return `  <url>\n    <loc>${escapeXml(location)}</loc>${lastModifiedElement}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/**
 * 把完整 Entry 集合投影为唯一的 M4 首页与详情读模型。
 *
 * 为什么存在：构建、回收测试和未来 CI 必须共享 published 过滤、固定分类顺序、评分排序与 ordinal 规则，不能只在文件写循环中隐式实现。
 * 数据如何流动：已校验 Entry 先按 category/rating 分组为 index entries；每个 published 条目再使用其分类位置生成 detail 白名单，recycled 完全不进入返回值。
 * 何时失败：公开投影中的 Markdown/URL 异常会抛错并阻断整体构建；空分类保留但 entries 为空。
 * 如何排查：先按 ID 运行 parseEntry，再比较 categories 中的位置与对应 detail archiveCode。
 * 什么不能改：不能从 legacy fixture、app.js 或旧 data 补内容，也不能让 recycled 条目生成任何详情 JSON。
 */
export function projectContent(entries: Entry[]) {
  const published = entries.filter((entry) => entry.status === "published");
  const categories = CATEGORY_IDS.map((categoryId) => ({
    id: categoryId,
    label: CATEGORY_META[categoryId].label,
    labelZh: CATEGORY_META[categoryId].labelZh,
    entries: filterEntries(published, { category: categoryId, sort: "rating" }).map(
      projectIndexEntry,
    ),
  }));
  const details = published.map((entry) => {
    const category = categories.find((candidate) => candidate.id === entry.category);
    const ordinal = Math.max(
      1,
      (category?.entries.findIndex((candidate) => candidate.id === entry.id) ?? 0) + 1,
    );
    return { id: entry.id, data: projectPublicEntry(entry, ordinal) };
  });
  return { categories, details };
}

/**
 * 读取并校验全部 Markdown 事实源，任何单文件损坏都会阻止公开 JSON 更新。
 *
 * 为什么存在：构建不能跳过坏条目继续发布旧数据，否则公开站会悄悄落后于 Git 历史。
 * 数据如何流动：按文件名排序读取 `content/entries/*.md`，统一交给 parseEntry，并验证文件名与不可变 ID 一致、ID 全局唯一。
 * 何时失败：目录不可读、Markdown 非法、文件名错位或 ID 重复时抛出稳定的构建错误。
 * 如何排查：错误 details 会给出文件或 ID；先用 `ai-index entry get` 和对应内容测试检查事实源。
 * 什么不能改：不能把解析失败降级为 warning，也不能从生成 JSON 反推事实源。
 */
export async function readAuthoritativeEntries(): Promise<Entry[]> {
  let files: string[] = [];
  try {
    files = (await readdir(contentDirectory)).filter((file) => file.endsWith(".md")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const entries: Entry[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const entry = parseEntry(await readFile(resolve(contentDirectory, file), "utf8"));
    if (file !== `${entry.id}.md`) {
      throw new AppError("BUILD_FAILED", "条目 ID 与文件名不一致", { file, id: entry.id });
    }
    if (ids.has(entry.id)) {
      throw new AppError("BUILD_FAILED", "条目 ID 重复", { id: entry.id });
    }
    ids.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

/**
 * 从全部权威 Markdown 生成首页与通用详情页公开读模型。
 *
 * 为什么存在：公开站必须只消费 Markdown 的白名单投影，并让 recycled 条目同时退出首页、详情与 sitemap。
 * 数据如何流动：全部事实源先筛选 published 条目，再生成 data 读模型、sitemap 与 robots；write=false 只做内存校验，不触碰两个输出目录。
 * 何时失败：事实源校验、公开投影、XML 序列化或任一 data/public 写入失败都会中止；顺序写入中途失败可能留下跨目录不一致的部分产物。
 * 如何排查：运行 `npm run build:content -- --check` 做无写入诊断；修复后必须重新运行普通 build:content，随后执行生产构建与 verify:release，不能发布部分输出。
 * 什么不能改：不能读取 app.js、历史 fixture 或生成文件反推内容；data 与 public 写入不是原子事务，失败后只能完整重建恢复一致性。
 */
export async function buildContent(
  options: { write?: boolean } = {},
): Promise<{ entries: number; details: number }> {
  const authoritativeEntries = await readAuthoritativeEntries();
  const { categories, details } = projectContent(authoritativeEntries);

  if (options.write !== false) {
    await rm(dataDirectory, { recursive: true, force: true });
    await mkdir(resolve(dataDirectory, "entries"), { recursive: true });
    await mkdir(publicDirectory, { recursive: true });
    await writeFile(
      resolve(dataDirectory, "index.json"),
      `${JSON.stringify({ categories }, null, 2)}\n`,
      "utf8",
    );
    for (const detail of details) {
      await writeFile(
        resolve(dataDirectory, "entries", `${detail.id}.json`),
        `${JSON.stringify(detail.data, null, 2)}\n`,
        "utf8",
      );
    }
    await writeFile(
      resolve(publicDirectory, "sitemap.xml"),
      buildSitemap(authoritativeEntries),
      "utf8",
    );
    await writeFile(resolve(publicDirectory, "robots.txt"), buildRobots(), "utf8");
  }

  return {
    entries: categories.reduce((total, category) => total + category.entries.length, 0),
    details: details.length,
  };
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  try {
    const checkOnly = process.argv.includes("--check");
    const result = await buildContent({ write: !checkOnly });
    process.stdout.write(
      `${JSON.stringify({ ok: true, command: "build:content", phase: "M9", check: checkOnly, ...result })}\n`,
    );
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError("BUILD_FAILED", "内容构建失败", {
            reason: error instanceof Error ? error.message : String(error),
          });
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: { code: appError.code, message: appError.message, details: appError.details } })}\n`,
    );
    process.exitCode = 1;
  }
}
