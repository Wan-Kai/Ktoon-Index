import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import legacyCategories from "../tests/fixtures/current-content.json";
import {
  CATEGORY_IDS,
  CATEGORY_META,
  AppError,
  parseEntry,
  projectIndexEntry,
  projectPublicEntry,
  type Entry,
} from "../src/content/index.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentDirectory = resolve(projectRoot, "content/entries");
const dataDirectory = resolve(projectRoot, "data");

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
 * 生成 M1 公开读模型，同时让未迁移的十九条演示数据继续工作。
 *
 * 为什么存在：M1 只迁移 MCP Inspector，页面又必须保持五分类完整；因此构建期暂时以 M0 fixture 填充未迁移条目，并由 Markdown 按 ID 覆盖。
 * 数据如何流动：先复制 M0 分类数据，再删除与事实源同 ID 的旧记录，加入 published Markdown 投影；recycled 条目从首页和详情产物排除。
 * 何时失败：事实源校验失败、输出目录不可写或 JSON 序列化失败时整体中止。
 * 如何排查：运行 `npm run build:content` 获取具体错误；确认 `data/` 没有被人工编辑并检查目录权限。
 * 什么不能改：这个兼容桥只允许在 M4 全量迁移后整体删除，不能让 migrated ID 同时保留 fixture 与 Markdown 两份事实。
 */
export async function buildContent(): Promise<{ entries: number; details: number }> {
  const authoritativeEntries = await readAuthoritativeEntries();
  const authoritativeIds = new Set(authoritativeEntries.map((entry) => entry.id));
  const categories = CATEGORY_IDS.map((categoryId) => {
    const legacy = legacyCategories.find((category) => category.id === categoryId);
    const entries = (legacy?.entries ?? []).filter((entry) => !authoritativeIds.has(entry.id));
    const migrated = authoritativeEntries
      .filter((entry) => entry.status === "published" && entry.category === categoryId)
      .map(projectIndexEntry);
    return {
      id: categoryId,
      label: CATEGORY_META[categoryId].label,
      labelZh: CATEGORY_META[categoryId].labelZh,
      entries: [...migrated, ...entries],
    };
  });

  await rm(dataDirectory, { recursive: true, force: true });
  await mkdir(resolve(dataDirectory, "entries"), { recursive: true });
  await writeFile(
    resolve(dataDirectory, "index.json"),
    `${JSON.stringify({ categories }, null, 2)}\n`,
    "utf8",
  );

  let details = 0;
  for (const entry of authoritativeEntries.filter(
    (candidate) => candidate.status === "published",
  )) {
    const category = categories.find((candidate) => candidate.id === entry.category);
    const ordinal = Math.max(
      1,
      (category?.entries.findIndex((candidate) => candidate.id === entry.id) ?? 0) + 1,
    );
    await writeFile(
      resolve(dataDirectory, "entries", `${entry.id}.json`),
      `${JSON.stringify(projectPublicEntry(entry, ordinal), null, 2)}\n`,
      "utf8",
    );
    details += 1;
  }

  return {
    entries: categories.reduce((total, category) => total + category.entries.length, 0),
    details,
  };
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  try {
    const result = await buildContent();
    process.stdout.write(
      `${JSON.stringify({ ok: true, command: "build:content", phase: "M1", ...result })}\n`,
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
