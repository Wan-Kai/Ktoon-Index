import { z } from "zod";

import { AppError } from "./errors.ts";

export const CATEGORY_IDS = ["toolkit", "products", "articles", "standards", "ideas"] as const;
export const RATINGS = ["夯", "人上人", "NPC"] as const;
export const ENTRY_STATUSES = ["published", "recycled"] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];
export type Rating = (typeof RATINGS)[number];
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const entryIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "ID 只能使用小写字母、数字和单个连字符");

const isoDateSchema = z.string().refine(
  (value) => {
    const time = Date.parse(value);
    return value.includes("T") && !Number.isNaN(time) && new Date(time).toISOString() === value;
  },
  { message: "时间必须是带 UTC 时区的标准 ISO 字符串" },
);

const httpsUrlSchema = z.string().superRefine((value, context) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "链接只允许 HTTPS" });
    }
    if (url.username || url.password) {
      context.addIssue({ code: "custom", message: "链接不能包含用户名或密码" });
    }
  } catch {
    context.addIssue({ code: "custom", message: "链接不是有效 URL" });
  }
});

export const sourceLinkSchema = z.object({
  title: z.string().trim().min(1, "来源标题不能为空"),
  url: httpsUrlSchema,
});

export const referenceLinkSchema = sourceLinkSchema.extend({
  description: z.string().trim().min(1, "资料描述不能为空").optional(),
});

export const createEntryInputSchema = z.object({
  id: entryIdSchema.optional(),
  title: z.string().trim().min(1, "标题不能为空"),
  summary: z.string().trim().min(1, "摘要不能为空"),
  category: z.enum(CATEGORY_IDS),
  tags: z.array(z.string()).default([]),
  rating: z.enum(RATINGS).nullable().default(null),
  source: sourceLinkSchema.nullable().optional(),
  references: z.array(referenceLinkSchema).default([]),
  personal_take: z.string().default(""),
});

/**
 * 阻止手工 Markdown 绕过创建入口后污染动态标签事实源。
 *
 * 为什么存在：标签没有独立词表，读取端若接受大小写、全半角差异或重复值，tag list 与筛选会对同一概念产生不同答案。
 * 数据如何流动：Entry Schema 把原始 tags 交给 normalizeTags，再逐项比较数量、顺序和值；只有已处于 canonical 形态的数组通过。
 * 何时失败：标签为空、含控制字符、需要进一步规范化或规范化后重复时向 Zod context 添加校验错误。
 * 如何排查：先用 normalizeTags 查看期望值，再修改 Markdown frontmatter；不能在读取时静默修复历史事实源。
 * 什么不能改：不能删除逐项等值检查，也不能让 listTags 自行补救，否则序列化往返和唯一枚举契约会失真。
 */
function enforceCanonicalTags(entry: { tags: string[] }, context: z.RefinementCtx): void {
  try {
    const normalized = normalizeTags(entry.tags);
    if (
      normalized.length !== entry.tags.length ||
      normalized.some((tag, index) => tag !== entry.tags[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["tags"],
        message: "事实源标签必须已经规范化且不能重复",
      });
    }
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["tags"],
      message: error instanceof Error ? error.message : "事实源标签不合法",
    });
  }
}

export const entrySchema = z
  .object({
    id: entryIdSchema,
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    category: z.enum(CATEGORY_IDS),
    tags: z.array(z.string()),
    rating: z.enum(RATINGS).nullable(),
    version: z.number().int().positive(),
    status: z.enum(ENTRY_STATUSES),
    addedAt: isoDateSchema,
    updatedAt: isoDateSchema,
    source: sourceLinkSchema.nullable(),
    references: z.array(referenceLinkSchema),
    personalTake: z.string(),
  })
  .superRefine(enforceCanonicalTags);

export type CreateEntryInput = z.infer<typeof createEntryInputSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type SourceLink = z.infer<typeof sourceLinkSchema>;
export type ReferenceLink = z.infer<typeof referenceLinkSchema>;

/**
 * 把用户输入的标签压缩成稳定、可枚举的标识。
 *
 * 为什么存在：标签没有独立管理后台，写入时必须消除大小写、全半角和空白差异，否则同一个概念会枚举成多个标签。
 * 数据如何流动：每个原始标签先做 NFKC、去首尾空白、转小写，再把连续空白转成连字符，最后按首次出现顺序去重。
 * 何时失败：标签为空、含控制字符或规范化后只剩连字符时抛出 `VALIDATION_FAILED`。
 * 如何排查：查看错误 details 中的原始标签，确认是否存在不可见字符或只输入了标点。
 * 什么不能改：不能在这里维护固定标签清单；产品已经确定标签必须从内容动态枚举。
 */
export function normalizeTags(tags: string[]): string[] {
  const normalized = tags.map((tag) =>
    tag.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/gu, "-").replace(/-+/gu, "-"),
  );

  for (let index = 0; index < normalized.length; index += 1) {
    const tag = normalized[index];
    if (!tag || /^[-]+$/u.test(tag) || /[\u0000-\u001f\u007f]/u.test(tag)) {
      throw new AppError("VALIDATION_FAILED", "标签规范化失败", { tag: tags[index] });
    }
  }

  return [...new Set(normalized)];
}

/**
 * 由标题生成不可变 ID，供未显式提供 ID 的创建请求使用。
 *
 * 为什么存在：CLI 默认要替 Agent 生成可预测路径，但 ID 一旦发布就不能随标题变化。
 * 数据如何流动：标题经 Unicode 分解、去重音、小写化和非字母数字折叠后得到 kebab-case。
 * 何时失败：中文等无法安全转成 ASCII 的标题可能得到空值，此时要求调用方显式传入 ID。
 * 如何排查：在创建 JSON 中增加只含小写字母、数字和连字符的 `id`。
 * 什么不能改：不能加入随机后缀或自动复用冲突 ID；ID 是唯一判重依据且回收后也不可复用。
 */
export function slugifyTitle(title: string): string {
  const id = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  if (!id) {
    throw new AppError("VALIDATION_FAILED", "标题无法自动生成 ID，请显式提供 id");
  }

  return entryIdSchema.parse(id);
}

/**
 * 校验创建 JSON 并注入只允许系统维护的字段。
 *
 * 为什么存在：调用者不能伪造版本、状态和时间；所有写入口必须共享同一创建规则。
 * 数据如何流动：未知输入先经过 Zod，随后规范化 ID、标签和正文首尾空白，并用同一时钟写入 version=1、published 和两个时间字段。
 * 何时失败：字段、枚举、HTTPS URL、ID 或标签不合法时统一抛出 `VALIDATION_FAILED`。
 * 如何排查：读取 details 中的 Zod issues，修正原始 JSON 后重新执行；失败发生在 GitHub 写入之前。
 * 什么不能改：不能允许输入覆盖 version、status、addedAt 或 updatedAt，也不能把校验推迟到远端提交之后。
 */
export function createEntry(input: unknown, now = new Date()): Entry {
  const parsed = createEntryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "条目 JSON 校验失败", parsed.error.issues);
  }

  const timestamp = now.toISOString();
  const entry = {
    id: parsed.data.id ?? slugifyTitle(parsed.data.title),
    title: parsed.data.title,
    summary: parsed.data.summary,
    category: parsed.data.category,
    tags: normalizeTags(parsed.data.tags),
    rating: parsed.data.rating,
    version: 1,
    status: "published" as const,
    addedAt: timestamp,
    updatedAt: timestamp,
    source: parsed.data.source ?? null,
    references: parsed.data.references,
    personalTake: parsed.data.personal_take.trim(),
  };

  const validated = entrySchema.safeParse(entry);
  if (!validated.success) {
    throw new AppError("VALIDATION_FAILED", "系统字段校验失败", validated.error.issues);
  }
  return validated.data;
}
