import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AppError } from "../src/content/index.ts";
import { projectContent, readAuthoritativeEntries } from "./build-content.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenPublicKeys = new Set(["maintainer", "requestid", "sha", "status", "version"]);

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat().sort();
}

function normalizeKey(key: string): string {
  return key.replace(/[_-]/gu, "").toLocaleLowerCase();
}

function findForbiddenKeys(value: unknown, path = "$", problems: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${path}[${index}]`, problems));
    return problems;
  }
  if (!value || typeof value !== "object") return problems;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenPublicKeys.has(normalizeKey(key)))
      problems.push(`公开数据泄漏维护字段：${childPath}`);
    findForbiddenKeys(child, childPath, problems);
  }
  return problems;
}

function extractReferences(file: string, source: string): string[] {
  if (file.endsWith(".html")) {
    return [...source.matchAll(/(?:src|href)=["']([^"']+)["']/gu)].map((match) => match[1]);
  }
  if (file.endsWith(".css")) {
    return [...source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gu)].map((match) => match[1]);
  }
  return [];
}

async function checkLocalReference(
  outputDirectory: string,
  sourceFile: string,
  reference: string,
  problems: string[],
): Promise<boolean> {
  if (/^(?:data:|https?:|mailto:|tel:|#)/iu.test(reference)) return false;
  const pathname = reference.split(/[?#]/u, 1)[0];
  if (!pathname) return false;
  if (pathname.startsWith("/")) {
    problems.push(
      `静态引用不能使用站点根路径：${relative(outputDirectory, sourceFile)} -> ${reference}`,
    );
    return true;
  }

  const target = resolve(dirname(sourceFile), pathname);
  const escaped = relative(outputDirectory, target);
  if (escaped.startsWith("..") || escaped === "..") {
    problems.push(`静态引用越出发布目录：${relative(outputDirectory, sourceFile)} -> ${reference}`);
    return true;
  }
  try {
    await access(target);
  } catch {
    problems.push(`静态引用缺失：${relative(outputDirectory, sourceFile)} -> ${reference}`);
  }
  return true;
}

/**
 * 验证最终 dist 确实由当前 Markdown 重建，并且可独立作为 GitHub Pages 发布包运行。
 *
 * Actions 在 Vite 构建后调用本函数：它重新投影事实源，与 dist 中的 index/detail JSON 逐字节语义比对，再检查 HTML/CSS 的本地资源闭环和公开字段边界。任何问题会聚合为 BUILD_FAILED，日志列出具体文件与引用；修复事实源或构建配置后重新提交即可恢复。这里不能降级为 warning，也不能改成只检查仓库根目录的 data，否则旧 JSON 或缺失静态资源仍可能被发布。
 */
export async function verifyReleasePackage(
  outputDirectory = resolve(projectRoot, "dist"),
): Promise<{ files: number; entries: number; details: number; references: number }> {
  const problems: string[] = [];
  const expected = projectContent(await readAuthoritativeEntries());
  const expectedIndex = { categories: expected.categories };
  const expectedDetails = new Map(expected.details.map((detail) => [detail.id, detail.data]));

  let files: string[] = [];
  try {
    files = await listFiles(outputDirectory);
  } catch (error) {
    throw new AppError("BUILD_FAILED", "发布目录不存在或不可读", {
      outputDirectory,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  for (const required of ["index.html", "detail.html", "app.js", "data/index.json"]) {
    if (!files.includes(resolve(outputDirectory, required)))
      problems.push(`发布文件缺失：${required}`);
  }
  for (const file of files) {
    if ((await stat(file)).size === 0)
      problems.push(`发布文件为空：${relative(outputDirectory, file)}`);
  }

  let actualIndex: unknown = null;
  try {
    actualIndex = JSON.parse(await readFile(resolve(outputDirectory, "data/index.json"), "utf8"));
    if (JSON.stringify(actualIndex) !== JSON.stringify(expectedIndex)) {
      problems.push("dist/data/index.json 与当前 Markdown 投影不一致");
    }
    findForbiddenKeys(actualIndex, "index", problems);
  } catch (error) {
    problems.push(
      `首页公开 JSON 无法读取：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const actualDetailFiles = files
    .filter(
      (file) =>
        dirname(file) === resolve(outputDirectory, "data/entries") && file.endsWith(".json"),
    )
    .map((file) => file.slice(file.lastIndexOf("/") + 1, -5))
    .sort();
  const expectedDetailIds = [...expectedDetails.keys()].sort();
  if (JSON.stringify(actualDetailFiles) !== JSON.stringify(expectedDetailIds)) {
    problems.push("dist/data/entries 文件集合与 published Markdown 不一致");
  }
  for (const [id, expectedDetail] of expectedDetails) {
    try {
      const actualDetail = JSON.parse(
        await readFile(resolve(outputDirectory, "data/entries", `${id}.json`), "utf8"),
      );
      if (JSON.stringify(actualDetail) !== JSON.stringify(expectedDetail)) {
        problems.push(`详情公开 JSON 与当前 Markdown 投影不一致：${id}`);
      }
      findForbiddenKeys(actualDetail, `entries.${id}`, problems);
    } catch (error) {
      problems.push(
        `详情公开 JSON 无法读取：${id}（${error instanceof Error ? error.message : String(error)}）`,
      );
    }
  }

  let references = 0;
  for (const file of files.filter(
    (candidate) => candidate.endsWith(".html") || candidate.endsWith(".css"),
  )) {
    const source = await readFile(file, "utf8");
    for (const reference of extractReferences(file, source)) {
      if (await checkLocalReference(outputDirectory, file, reference, problems)) references += 1;
    }
  }

  if (problems.length > 0) {
    throw new AppError("BUILD_FAILED", "发布包校验失败", { outputDirectory, problems });
  }
  return {
    files: files.length,
    entries: expected.categories.flatMap((item) => item.entries).length,
    details: expected.details.length,
    references,
  };
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  try {
    const directoryFlag = process.argv.indexOf("--dir");
    if (directoryFlag >= 0 && !process.argv[directoryFlag + 1]) {
      throw new AppError("BUILD_FAILED", "--dir 缺少发布目录");
    }
    const outputDirectory =
      directoryFlag >= 0 ? resolve(process.argv[directoryFlag + 1]) : undefined;
    const result = await verifyReleasePackage(outputDirectory);
    process.stdout.write(`${JSON.stringify({ ok: true, command: "verify:release", ...result })}\n`);
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError("BUILD_FAILED", "发布包校验失败", {
            reason: error instanceof Error ? error.message : String(error),
          });
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: { code: appError.code, message: appError.message, details: appError.details } })}\n`,
    );
    process.exitCode = 1;
  }
}
