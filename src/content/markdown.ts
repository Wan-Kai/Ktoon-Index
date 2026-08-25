import matter from "gray-matter";
import MarkdownIt from "markdown-it";

import { AppError } from "./errors.ts";
import { entrySchema, type Entry } from "./schema.ts";

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
const allowedTokenTypes = new Set([
  "paragraph_open",
  "paragraph_close",
  "inline",
  "text",
  "softbreak",
  "hardbreak",
  "strong_open",
  "strong_close",
  "em_open",
  "em_close",
  "code_inline",
  "bullet_list_open",
  "bullet_list_close",
  "ordered_list_open",
  "ordered_list_close",
  "list_item_open",
  "list_item_close",
  "link_open",
  "link_close",
]);
const frontmatterKeys = new Set([
  "id",
  "title",
  "summary",
  "category",
  "tags",
  "rating",
  "version",
  "status",
  "added_at",
  "updated_at",
  "source",
  "references",
]);

/**
 * 拒绝事实源 Frontmatter 中未声明的字段。
 *
 * 为什么存在：gray-matter 会保留额外 YAML 键，而后续字段投影若静默丢弃它们，会让手工注入或拼写错误看似发布成功。解析后的键集合进入白名单比较；命中未知键立即返回 VALIDATION_FAILED，不修改输入。排查时删除 details.unknown 中的字段或改为正式 Schema 名称。不能在 candidate 投影后再检查，否则未知信息已经丢失。
 */
function assertKnownFrontmatter(data: Record<string, unknown>): void {
  const unknown = Object.keys(data).filter((key) => !frontmatterKeys.has(key));
  if (unknown.length > 0) {
    throw new AppError("VALIDATION_FAILED", "条目 Frontmatter 包含未知字段", { unknown });
  }
}

/**
 * 对 Markdown token 与原始语法中的 URL 执行同一安全边界。
 *
 * 为什么存在：markdown-it 会把部分危险链接降级成文本，单看 token 会漏掉攻击尝试；预扫描与 token 检查必须复用同一规则。
 * 数据如何流动：原始 href 解析为 URL，只接受无 username/password 的 HTTPS，其余全部抛出领域错误。
 * 何时失败：无效 URL、非 HTTPS 或内嵌凭据都会在公开 HTML 生成前失败。
 * 如何排查：删除 URL 凭据并换成完整 HTTPS 地址；不要对错误链接做浏览器端补救。
 * 什么不能改：不能只检查 protocol，`https://user:pass@host` 同样会把敏感信息公开。
 */
function assertSafeMarkdownUrl(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe url");
  } catch {
    throw new AppError("VALIDATION_FAILED", "Markdown 链接只允许不含凭据的 HTTPS", {
      href: value,
    });
  }
}

/**
 * 校验个人判断使用的受限 Markdown，并返回可公开渲染的安全 HTML。
 *
 * 为什么存在：Markdown 来自 Agent 可写内容，必须把表达能力限定为已确认的文字排版，避免原始 HTML、图片和可执行协议进入公开站。
 * 数据如何流动：markdown-it 先生成 token 树，函数递归检查 token 类型和链接协议，全部通过后才用禁用 HTML 的同一实例渲染。
 * 何时失败：出现标题、引用、代码块、图片、原始 HTML、表格或非 HTTPS 链接时抛出 `VALIDATION_FAILED`。
 * 如何排查：把正文收敛为段落、粗体、斜体、列表、行内代码和 HTTPS 链接，错误 details 会指出首个不允许的 token。
 * 什么不能改：不能只依赖渲染器转义 HTML 后继续接受；产品要求这些结构在事实源层就被拒绝。
 */
export function renderRestrictedMarkdown(source: string): string {
  // markdown-it 在 html=false 时会把原始标签降级成普通文本；产品要求事实源直接拒绝，因此解析前显式拦截。
  if (/<\/?[a-z][^>]*>|<!--|<!doctype/iu.test(source)) {
    throw new AppError("VALIDATION_FAILED", "个人判断不允许原始 HTML");
  }
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)\s]+)/gu)) {
    assertSafeMarkdownUrl(match[1]);
  }

  const tokens = markdown.parse(source, {});
  const queue = [...tokens];

  while (queue.length > 0) {
    const token = queue.shift();
    if (!token) continue;
    if (!allowedTokenTypes.has(token.type)) {
      throw new AppError("VALIDATION_FAILED", "个人判断包含不支持的 Markdown", {
        token: token.type,
      });
    }
    if (token.type === "link_open") {
      const href = token.attrGet("href") ?? "";
      assertSafeMarkdownUrl(href);
    }
    if (token.children) queue.push(...token.children);
  }

  return markdown.render(source).trim();
}

/**
 * 把领域条目序列化为唯一、稳定的 Markdown 事实源。
 *
 * 为什么存在：Git diff 必须可读且字段顺序稳定，CLI create/get 与内容构建不能各自定义 Frontmatter。
 * 数据如何流动：领域对象先再次通过 Schema 与 Markdown 校验，再转换为 snake_case Frontmatter，个人判断保留在正文。
 * 何时失败：对象字段或 Markdown 非法时在生成文件前失败。
 * 如何排查：先运行内容模块测试，再检查调用者是否绕过 createEntry 构造了领域对象。
 * 什么不能改：系统字段必须保留在 Frontmatter；正文只能保存 personalTake，不能复制结构化字段。
 */
export function serializeEntry(entry: Entry): string {
  const validated = entrySchema.parse(entry);
  renderRestrictedMarkdown(validated.personalTake);

  return matter.stringify(`${validated.personalTake.trim()}\n`, {
    id: validated.id,
    title: validated.title,
    summary: validated.summary,
    category: validated.category,
    tags: validated.tags,
    rating: validated.rating,
    version: validated.version,
    status: validated.status,
    added_at: validated.addedAt,
    updated_at: validated.updatedAt,
    source: validated.source,
    references: validated.references,
  });
}

/**
 * 从仓库 Markdown 还原领域对象。
 *
 * 为什么存在：CLI get、构建脚本和未来 update 必须把同一文件解释成完全相同的数据。
 * 数据如何流动：gray-matter 分离 Frontmatter 与正文，snake_case 系统字段映射为领域命名，随后执行完整 Schema 与受限 Markdown 校验。
 * 何时失败：YAML 损坏、必填字段缺失、系统字段异常或正文越权时统一返回 `VALIDATION_FAILED`。
 * 如何排查：检查对应 `content/entries/<id>.md` 的 Frontmatter 和正文；不要直接跳过解析继续发布。
 * 什么不能改：不能容忍未知状态、非 HTTPS 链接或无法解析的时间后做默认填充，否则事实源损坏会被掩盖。
 */
export function parseEntry(source: string): Entry {
  try {
    const parsed = matter(source);
    assertKnownFrontmatter(parsed.data);
    const candidate = {
      id: parsed.data.id,
      title: parsed.data.title,
      summary: parsed.data.summary,
      category: parsed.data.category,
      tags: parsed.data.tags,
      rating: parsed.data.rating ?? null,
      version: parsed.data.version,
      status: parsed.data.status,
      addedAt: parsed.data.added_at,
      updatedAt: parsed.data.updated_at,
      source: parsed.data.source ?? null,
      references: parsed.data.references ?? [],
      personalTake: parsed.content.trim(),
    };
    const validated = entrySchema.parse(candidate);
    renderRestrictedMarkdown(validated.personalTake);
    return validated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("VALIDATION_FAILED", "条目 Markdown 解析失败", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
