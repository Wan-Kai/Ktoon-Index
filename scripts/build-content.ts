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
 * 为什么存在：M4 已删除 legacy 桥，公开站必须只消费二十份 Markdown 的白名单投影，并让 recycled 条目完全退出首页与详情产物。
 * 数据如何流动：全部事实源先按固定分类与评分优先语义筛选 published 条目，再分别生成 index entry 和带稳定分类 ordinal 的 detail；write=false 只做内存校验。
 * 何时失败：事实源校验失败、公开投影失败，或 write=true 时输出目录不可写/JSON 序列化失败会中止；顺序写入中途失败可能留下部分 data。
 * 如何排查：运行 `npm run build:content -- --check` 做无写入诊断；修复后必须重新运行普通 build:content 完整重建，不能继续使用部分输出。
 * 什么不能改：不能读取 app.js、历史 fixture 或生成 JSON 补齐内容；顺序写入并非原子事务，失败后必须修复原因并重新完整构建。
 */
export async function buildContent(
  options: { write?: boolean } = {},
): Promise<{ entries: number; details: number }> {
  const authoritativeEntries = await readAuthoritativeEntries();
  const { categories, details } = projectContent(authoritativeEntries);

  if (options.write !== false) {
    await rm(dataDirectory, { recursive: true, force: true });
    await mkdir(resolve(dataDirectory, "entries"), { recursive: true });
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
      `${JSON.stringify({ ok: true, command: "build:content", phase: "M5", check: checkOnly, ...result })}\n`,
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
