import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import postcss from "postcss";
import valueParser from "postcss-value-parser";

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
 * 为什么存在：`request_id`、`request-id` 与 `requestId` 都属于同一泄漏。键名进入本函数后仅用于安全比较；纯字符串变换没有失败分支。排查时检查命中的原字段。不能删除分隔符归一，否则改写命名即可绕过禁键。
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
 * 按 srcset 候选语法提取 URL，并保留 data URI 后面的本地候选。
 *
 * 为什么存在：data URI 自身包含逗号，直接 split 或整组跳过都会漏掉后续资源。扫描器先读取不含空白的 URL token，再跳过 descriptor 到候选分隔符；畸形输入会尽量返回已识别 URL，不抛错。排查时检查原 srcset 的空白与 descriptor。不能把整个 data: 开头值视为单一候选。
 */
function extractSrcsetUrls(source: string): string[] {
  const urls: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    while (cursor < source.length && /[\s,]/u.test(source[cursor])) cursor += 1;
    if (cursor >= source.length) break;

    const start = cursor;
    while (cursor < source.length && !/\s/u.test(source[cursor])) cursor += 1;
    const rawUrl = source.slice(start, cursor);
    const endedAtCandidateSeparator = /,+$/u.test(rawUrl);
    const url = rawUrl.replace(/,+$/u, "");
    if (url) urls.push(url);
    if (endedAtCandidateSeparator) continue;

    while (cursor < source.length && source[cursor] !== ",") cursor += 1;
    if (source[cursor] === ",") cursor += 1;
  }
  return urls;
}

/**
 * 按 CSS Syntax 规则解码标识符与 URL token 中的反斜杠转义。
 *
 * 为什么存在：浏览器会把 `u\\72l` 与十六进制点段还原后再解释资源地址。字符串进入后逐个替换 hex、换行和普通转义；非法 code point 使用替代字符，不抛错。排查时比较 PostCSS token 与解码值。不能只解码 URL 参数而保留函数名，否则可漏掉 url()。
 */
function decodeCssEscapes(source: string): string {
  return source.replace(
    /\\(?:([\da-f]{1,6})(?:\r\n|[ \n\r\t\f])?|(\r\n|[\n\r\f])|(.))/giu,
    (_escape, hex, newline, character) => {
      if (hex) {
        const codePoint = Number.parseInt(hex, 16);
        if (
          codePoint === 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return "�";
        }
        return String.fromCodePoint(codePoint);
      }
      return newline ? "" : character;
    },
  );
}

/**
 * 从单个 CSS value 中提取 url() 与 image-set() 的资源候选。
 *
 * 为什么存在：声明值可以嵌套函数，且函数名本身允许转义。value-parser 深度遍历 token；url() 读取完整参数，image-set() 与兼容前缀 -webkit-image-set() 额外收集字符串 image。畸形 value 由 parser 尽量恢复且不会主动访问文件。排查时检查 token 类型。不能把 local() 字体名或普通字符串当作资源。
 */
function extractUrlsFromCssValue(source: string): string[] {
  const references: string[] = [];
  valueParser(source).walk((node) => {
    if (node.type !== "function") return;
    const functionName = decodeCssEscapes(node.value).toLocaleLowerCase();
    if (functionName === "url") {
      const serialized = valueParser.stringify(node.nodes).trim();
      const unquoted =
        (serialized.startsWith('"') && serialized.endsWith('"')) ||
        (serialized.startsWith("'") && serialized.endsWith("'"))
          ? serialized.slice(1, -1)
          : serialized;
      references.push(decodeCssEscapes(unquoted));
    } else if (functionName === "image-set" || functionName === "-webkit-image-set") {
      for (const child of node.nodes) {
        if (child.type === "string") references.push(decodeCssEscapes(child.value));
      }
    }
  });
  return references;
}

/**
 * 从 @import 参数的首个语法节点读取唯一导入目标。
 *
 * 为什么存在：@import 的 supports/media 条件也可能包含 url()，但它们不是导入目标。参数进入后只检查首个非空白节点；字符串直接解码，url() 复用 value 提取器，其余形态视为无有效静态目标。解析失败由上层 PostCSS 路径统一转为 BUILD_FAILED；排查时检查首节点 token。不能扫描整段参数后凭 URL 数量猜测目标，否则条件 URL 会掩盖真正文件。
 */
function extractImportReference(source: string): string | undefined {
  const parsed = valueParser(source);
  const target = parsed.nodes.find((node) => node.type !== "space" && node.type !== "comment");
  if (!target) return undefined;
  if (target.type === "string") return decodeCssEscapes(target.value);
  if (target.type !== "function" || decodeCssEscapes(target.value).toLocaleLowerCase() !== "url") {
    return undefined;
  }
  return extractUrlsFromCssValue(valueParser.stringify(target))[0];
}

/**
 * 从 at-rule 原文消费完整 CSS ident，确认 @import 后返回参数。
 *
 * 为什么存在：CSS at-keyword 的 ident 允许转义，而 PostCSS 会拆开转义名称。规则原文进入后逐字符消费 name char 与完整 escape，再跳过名称后的空白或 comment；只有完整解码名等于 import 才返回剩余参数。无法确认时返回 undefined，不把 @importurl 等未知规则当导入。排查时比较 rule.toString() 与消费游标。不能退回 name/params 拼接猜测，否则 comment 与前缀名称会造成漏检或误报。
 */
function resolveImportParameters(serializedRule: string): string | undefined {
  if (!serializedRule.startsWith("@")) return undefined;
  let cursor = 1;
  let rawName = "";
  while (cursor < serializedRule.length) {
    const character = serializedRule[cursor];
    if (/[-_\p{L}\p{N}]/u.test(character)) {
      rawName += character;
      cursor += 1;
      continue;
    }
    if (character !== "\\") break;
    const escapeStart = cursor;
    cursor += 1;
    const hexStart = cursor;
    while (
      cursor < serializedRule.length &&
      cursor - hexStart < 6 &&
      /[\da-f]/iu.test(serializedRule[cursor])
    ) {
      cursor += 1;
    }
    if (cursor === hexStart && cursor < serializedRule.length) cursor += 1;
    if (cursor > hexStart && /\s/u.test(serializedRule[cursor] ?? "")) {
      if (serializedRule[cursor] === "\r" && serializedRule[cursor + 1] === "\n") cursor += 1;
      cursor += 1;
    }
    rawName += serializedRule.slice(escapeStart, cursor);
  }
  if (decodeCssEscapes(rawName).toLocaleLowerCase() !== "import") return undefined;
  while (cursor < serializedRule.length) {
    if (/\s/u.test(serializedRule[cursor])) {
      cursor += 1;
      continue;
    }
    if (serializedRule.startsWith("/*", cursor)) {
      const commentEnd = serializedRule.indexOf("*/", cursor + 2);
      if (commentEnd === -1) return undefined;
      cursor = commentEnd + 2;
      continue;
    }
    break;
  }
  return serializedRule.slice(cursor);
}

/**
 * 解析完整 stylesheet 或 style 属性声明列表中的全部资源引用。
 *
 * 为什么存在：外部 CSS、style 节点与 style 属性必须共享同一 URL 规则。调用方显式传入模式；declarations 会包进临时规则，stylesheet 原样交给 PostCSS。语法错误抛给上层聚合为 BUILD_FAILED；排查时定位对应源码。不能把模式退回 boolean，也不能在含 url() 的 @import 中把媒体条件当文件。
 */
function extractCssReferences(source: string, mode: "stylesheet" | "declarations"): string[] {
  const references: string[] = [];
  const root = postcss.parse(mode === "declarations" ? `a{${source}}` : source);
  root.walkDecls((declaration) => {
    references.push(...extractUrlsFromCssValue(declaration.value));
  });
  root.walkAtRules((rule) => {
    const importParameters = resolveImportParameters(rule.toString());
    if (importParameters === undefined) return;
    const reference = extractImportReference(importParameters);
    if (reference) references.push(reference);
  });
  return references;
}

/**
 * 从构建后源码提取浏览器资源引用，并识别会改变解析基准的真实 `<base>`。
 *
 * 为什么存在：Pages 子路径和缺失资产必须在上传前发现。HTML 由 parse5 生成解析树并完成实体、注释和无引号属性处理；递归遍历元素属性、style 属性与 style 节点，srcset 与 preload 使用的 imagesrcset 共享候选解析，同时将真实 base 作为独立信号返回。外部和内联 CSS 由 PostCSS 解析，URL token 再做 CSS escape 解码。PostCSS 解析失败会抛给调用方聚合为 BUILD_FAILED；排查时查看对应构建文件。不能换回 HTML/CSS 正则、遗漏 preload 候选或丢弃 hasBase 信号。
 */
function inspectSourceReferences(
  file: string,
  source: string,
): { references: string[]; hasBase: boolean } {
  if (file.endsWith(".html")) {
    const references: string[] = [];
    let hasBase = false;
    const visit = (node: DefaultTreeAdapterMap["node"]): void => {
      if ("attrs" in node) {
        // parse5 只把真实元素交给该分支，注释中的伪标签不会触发 base 禁止规则。
        if (node.tagName === "base") hasBase = true;
        for (const attribute of node.attrs) {
          if (["src", "href", "poster", "data"].includes(attribute.name)) {
            references.push(attribute.value);
          } else if (attribute.name === "srcset" || attribute.name === "imagesrcset") {
            references.push(...extractSrcsetUrls(attribute.value));
          } else if (attribute.name === "style") {
            references.push(...extractCssReferences(attribute.value, "declarations"));
          }
        }
        // style 节点的文本不是普通属性，需要单独交给完整 CSS parser。
        if (node.tagName === "style") {
          const css = node.childNodes
            .filter((child) => child.nodeName === "#text")
            .map((child) => ("value" in child ? child.value : ""))
            .join("");
          references.push(...extractCssReferences(css, "stylesheet"));
        }
      }
      // 必须递归完整 parse tree；剪掉 head/body 任一分支都会遗漏 base、style 或资源属性。
      if ("childNodes" in node) node.childNodes.forEach(visit);
    };
    visit(parse(source));
    return { references: [...new Set(references)], hasBase };
  }
  if (file.endsWith(".css")) {
    return {
      references: [...new Set(extractCssReferences(source, "stylesheet"))],
      hasBase: false,
    };
  }
  return { references: [], hasBase: false };
}

/**
 * 验证单个本地引用存在且真实路径仍位于发布目录内。
 *
 * 为什么存在：词法 `../` 检查无法复现浏览器的点段、百分号编码和同源根路径语义。HTML 属性已由 parse5 按浏览器规则解码，随后引用以 WHATWG URL 在虚拟 `/__release__/` 前缀解析；所有非 HTTP(S) scheme 直接跳过，HTTP(S) 仅在解析后确认跨域时作为外链跳过，同源引用必须保留前缀。最后 decodeURIComponent 映射文件，并依次做词法 containment 与 realpath/symlink containment。URL、百分号或真实路径失败会聚合为 BUILD_FAILED；排查时比较浏览器最终 URL。不能调整顺序或在 URL 解析前按字符串跳过外链。
 */
async function checkLocalReference(
  outputDirectory: string,
  realOutputDirectory: string,
  sourceFile: string,
  reference: string,
  problems: string[],
): Promise<boolean> {
  const virtualRoot = "/__release__/";
  const sourcePath = relative(outputDirectory, sourceFile).split(sep).join("/");
  let pathname = "";
  try {
    const parsed = new URL(reference, `https://release.invalid${virtualRoot}${sourcePath}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.origin !== "https://release.invalid") return false;
    if (!parsed.pathname.startsWith(virtualRoot)) {
      problems.push(
        `静态引用按 URL 解析后越出发布目录：${relative(outputDirectory, sourceFile)} -> ${reference}`,
      );
      return true;
    }
    pathname = decodeURIComponent(parsed.pathname.slice(virtualRoot.length));
  } catch {
    problems.push(
      `静态引用 URL 无法解析：${relative(outputDirectory, sourceFile)} -> ${reference}`,
    );
    return true;
  }

  const target = resolve(outputDirectory, pathname);
  const escaped = relative(outputDirectory, target);
  if (escaped === ".." || escaped.startsWith(`..${sep}`)) {
    problems.push(`静态引用越出发布目录：${relative(outputDirectory, sourceFile)} -> ${reference}`);
    return true;
  }
  try {
    const realTarget = await realpath(target);
    const realEscaped = relative(realOutputDirectory, realTarget);
    if (realEscaped === ".." || realEscaped.startsWith(`..${sep}`)) {
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
 * Actions 在 Vite 构建后调用本函数：它重新投影事实源，与 dist 中的 index/detail JSON 逐字节语义比对，再检查完整 data 白名单、dist 内全部 JSON 禁键、静态资源真实路径和 symlink。任何问题聚合为 BUILD_FAILED；修复事实源或构建配置后重新提交即可恢复。这里不能降级为 warning，也不能改成只检查仓库根目录的 data。
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
  for (const file of files.filter((candidate) => candidate.toLocaleLowerCase().endsWith(".json"))) {
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
    let extracted: { references: string[]; hasBase: boolean };
    try {
      extracted = inspectSourceReferences(file, source);
    } catch (error) {
      // 单文件解析失败后继续检查其余文件，以一次日志返回尽可能完整的问题集合。
      problems.push(
        `静态源码无法解析：${relative(outputDirectory, file)}（${error instanceof Error ? error.message : String(error)}）`,
      );
      continue;
    }
    // 项目依赖相对路径适配 GitHub Pages 子目录；真实 base 元素会改写整页基准，因此明确禁止。
    if (extracted.hasBase) {
      problems.push(`发布 HTML 不允许 base 元素：${relative(outputDirectory, file)}`);
    }
    for (const reference of extracted.references) {
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
