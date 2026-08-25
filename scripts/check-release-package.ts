import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AppError } from "../src/content/index.ts";
import { projectContent, readAuthoritativeEntries } from "./build-content.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenPublicKeys = new Set(["maintainer", "requestid", "sha", "status", "version"]);

/**
 * 递归枚举发布目录中的实际条目，但不跟随符号链接。
 *
 * 为什么存在：发布检查必须看到额外文件和 symlink 本身，不能只遍历预期路径。数据从目录项递归汇总为绝对路径；目录不可读时直接失败。排查时检查报错目录与构建权限。不能改为 follow symlink，否则目录外内容可能被当成正常产物。
 */
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

/**
 * 统一维护字段键名的大小写与分隔符表示。
 *
 * 为什么存在：`request_id`、`request-id` 与 `requestId` 都属于同一泄漏。键名进入本函数后仅用于安全比较；非字符串键不会来自 JSON。排查时检查命中的原字段。不能删除分隔符归一，否则改写命名即可绕过禁键。
 */
function normalizeKey(key: string): string {
  return key.replace(/[_-]/gu, "").toLocaleLowerCase();
}

/**
 * 递归检查任意公开 JSON 中的维护侧字段。
 *
 * 为什么存在：维护字段可能藏在数组、嵌套对象或额外 JSON 中。已解析 JSON 从根节点递归，问题以 path 聚合；解析失败由调用方报告。排查时按 path 回看公开投影。不能只检查顶层或预期详情，否则额外文件可以泄漏状态与版本。
 */
function findForbiddenKeys(value: unknown, path = "$", problems: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${path}[${index}]`, problems));
    return problems;
  }
  if (!value || typeof value !== "object") return problems;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenPublicKeys.has(normalizeKey(key))) {
      problems.push(`公开数据泄漏维护字段：${childPath}`);
    }
    findForbiddenKeys(child, childPath, problems);
  }
  return problems;
}

/**
 * 提取 HTML 与 CSS 中会由浏览器加载的静态引用。
 *
 * 为什么存在：Pages 子路径和缺失资产必须在上传前发现。HTML 支持带引号或无引号的 src/href/poster/data/srcset，CSS 支持 url() 与字符串 @import；其他文件返回空集合。排查时查看构建后源码。不能收窄为双引号属性或只检查 url()，否则合法语法可绕过资源闭环。
 */
function extractReferences(file: string, source: string): string[] {
  if (file.endsWith(".html")) {
    const attributes = [
      ...source.matchAll(
        /\b(?:src|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu,
      ),
    ].map((match) => match[1] ?? match[2] ?? match[3]);
    const srcsets = [
      ...source.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu),
    ].flatMap((match) => {
      const value = match[1] ?? match[2] ?? match[3];
      if (value.trim().startsWith("data:")) return [];
      return value.split(",").map((candidate) => candidate.trim().split(/\s+/u, 1)[0]);
    });
    return [...new Set([...attributes, ...srcsets])];
  }
  if (file.endsWith(".css")) {
    const urls = [...source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)].map(
      (match) => match[1],
    );
    const imports = [...source.matchAll(/@import\s+(?!url\()(?:"([^"]+)"|'([^']+)')/giu)].map(
      (match) => match[1] ?? match[2],
    );
    return [...new Set([...urls, ...imports])];
  }
  return [];
}

/**
 * 验证单个本地引用存在且真实路径仍位于发布目录内。
 *
 * 为什么存在：词法 `../` 检查无法识别 symlink 逃逸。引用先按源文件解析，再由 realpath 核对最终目标；外链、data URL 与 fragment 跳过。缺失或越界会聚合为 BUILD_FAILED。排查时检查源文件与 symlink。不能退回 access-only 检查。
 */
async function checkLocalReference(
  outputDirectory: string,
  realOutputDirectory: string,
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
    const realTarget = await realpath(target);
    const realEscaped = relative(realOutputDirectory, realTarget);
    if (realEscaped.startsWith("..") || realEscaped === "..") {
      problems.push(
        `静态引用真实路径越出发布目录：${relative(outputDirectory, sourceFile)} -> ${reference}`,
      );
    }
  } catch {
    problems.push(`静态引用缺失：${relative(outputDirectory, sourceFile)} -> ${reference}`);
  }
  return true;
}

/**
 * 验证最终 dist 确实由当前 Markdown 重建，并且可独立作为 GitHub Pages 发布包运行。
 *
 * Actions 在 Vite 构建后调用本函数：它重新投影事实源，与 dist 中的 index/detail JSON 逐字节语义比对，再检查完整 data 白名单、所有公开 JSON 禁键、静态资源真实路径和 symlink。任何问题聚合为 BUILD_FAILED；修复事实源或构建配置后重新提交即可恢复。这里不能降级为 warning，也不能改成只检查仓库根目录的 data。
 */
export async function verifyReleasePackage(
  outputDirectory = resolve(projectRoot, "dist"),
): Promise<{ files: number; entries: number; details: number; references: number }> {
  const problems: string[] = [];
  const expected = projectContent(await readAuthoritativeEntries());
  const expectedIndex = { categories: expected.categories };
  const expectedDetails = new Map(expected.details.map((detail) => [detail.id, detail.data]));

  let files: string[] = [];
  let realOutputDirectory = outputDirectory;
  try {
    realOutputDirectory = await realpath(outputDirectory);
    files = await listFiles(outputDirectory);
  } catch (error) {
    throw new AppError("BUILD_FAILED", "发布目录不存在或不可读", {
      outputDirectory,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  for (const required of ["index.html", "detail.html", "app.js", "data/index.json"]) {
    if (!files.includes(resolve(outputDirectory, required))) {
      problems.push(`发布文件缺失：${required}`);
    }
  }
  for (const file of files) {
    const metadata = await lstat(file);
    if (metadata.isSymbolicLink()) {
      problems.push(`发布包不得包含符号链接：${relative(outputDirectory, file)}`);
    } else if (metadata.size === 0) {
      problems.push(`发布文件为空：${relative(outputDirectory, file)}`);
    }
  }

  const allowedDataFiles = new Set([
    resolve(outputDirectory, "data/index.json"),
    ...[...expectedDetails.keys()].map((id) =>
      resolve(outputDirectory, "data/entries", `${id}.json`),
    ),
  ]);
  const dataDirectory = resolve(outputDirectory, "data");
  const actualDataFiles = files.filter((file) => {
    const path = relative(dataDirectory, file);
    return path !== ".." && !path.startsWith("../");
  });
  for (const file of actualDataFiles) {
    if (!allowedDataFiles.has(file)) {
      problems.push(`发布数据包含未授权文件：${relative(outputDirectory, file)}`);
    }
  }

  const publicJson = new Map<string, unknown>();
  for (const file of actualDataFiles.filter((candidate) => candidate.endsWith(".json"))) {
    try {
      const value = JSON.parse(await readFile(file, "utf8"));
      publicJson.set(file, value);
      findForbiddenKeys(value, relative(outputDirectory, file), problems);
    } catch (error) {
      problems.push(
        `公开 JSON 无法解析：${relative(outputDirectory, file)}（${error instanceof Error ? error.message : String(error)}）`,
      );
    }
  }

  const indexPath = resolve(outputDirectory, "data/index.json");
  const actualIndex = publicJson.get(indexPath);
  if (actualIndex === undefined) {
    problems.push("首页公开 JSON 不存在或无法解析：data/index.json");
  } else if (JSON.stringify(actualIndex) !== JSON.stringify(expectedIndex)) {
    problems.push("dist/data/index.json 与当前 Markdown 投影不一致");
  }

  for (const [id, expectedDetail] of expectedDetails) {
    const detailPath = resolve(outputDirectory, "data/entries", `${id}.json`);
    const actualDetail = publicJson.get(detailPath);
    if (actualDetail === undefined) {
      problems.push(`详情公开 JSON 不存在或无法解析：${id}`);
    } else if (JSON.stringify(actualDetail) !== JSON.stringify(expectedDetail)) {
      problems.push(`详情公开 JSON 与当前 Markdown 投影不一致：${id}`);
    }
  }

  let references = 0;
  for (const file of files.filter(
    (candidate) => candidate.endsWith(".html") || candidate.endsWith(".css"),
  )) {
    const source = await readFile(file, "utf8");
    for (const reference of extractReferences(file, source)) {
      if (
        await checkLocalReference(outputDirectory, realOutputDirectory, file, reference, problems)
      ) {
        references += 1;
      }
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
