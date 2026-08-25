import { z } from "zod";

import { AppError } from "./errors.ts";
import {
  CATEGORY_IDS,
  RATINGS,
  entrySchema,
  normalizeTags,
  referenceLinkSchema,
  sourceLinkSchema,
  type Entry,
  type EntryStatus,
} from "./schema.ts";

const expectedShaSchema = z
  .string()
  .regex(/^[a-f0-9]{40}$/u, "expected_sha 必须是小写的完整 Git blob SHA");

const mutationGuardSchema = z
  .object({
    expected_version: z.number().int().positive(),
    expected_sha: expectedShaSchema,
  })
  .strict();

const entryPatchSchema = z
  .object({
    title: z.string().trim().min(1, "标题不能为空").optional(),
    summary: z.string().trim().min(1, "摘要不能为空").optional(),
    category: z.enum(CATEGORY_IDS).optional(),
    tags: z.array(z.string()).optional(),
    rating: z.enum(RATINGS).nullable().optional(),
    source: sourceLinkSchema.nullable().optional(),
    references: z.array(referenceLinkSchema).optional(),
    personal_take: z.string().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "patch 至少包含一个字段");

const updateEntryRequestSchema = mutationGuardSchema.extend({ patch: entryPatchSchema }).strict();

export type MutationGuard = z.infer<typeof mutationGuardSchema>;
export type UpdateEntryRequest = z.infer<typeof updateEntryRequestSchema>;

/**
 * 在访问 GitHub 前解析 update JSON 的并发护栏与 Merge Patch。
 *
 * 为什么存在：写操作只接受 JSON，未知字段、空 patch、非法 SHA 或字段清空必须在任何远端读取前失败。
 * 数据如何流动：unknown 进入严格 Zod Schema，得到 expected_version、expected_sha 和字段白名单 patch，随后才交给领域更新与 GitHub CAS。
 * 何时失败：护栏缺失、SHA/版本非法、必填字段为 null、数组类型错误或 patch 为空时返回 VALIDATION_FAILED。
 * 如何排查：对照错误 issues 修正 JSON；可选字段只允许 rating/source 使用 null，tags/references 要清空请传空数组。
 * 什么不能改：不能允许 patch 修改 id、version、status、added_at 或 updated_at，也不能静默忽略未知字段。
 */
export function parseUpdateEntryRequest(input: unknown): UpdateEntryRequest {
  const parsed = updateEntryRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "update JSON 校验失败", parsed.error.issues);
  }
  return parsed.data;
}

/**
 * 在访问 GitHub 前解析 delete/restore 共用的版本与 SHA 护栏。
 *
 * 为什么存在：回收和恢复不接收内容 patch，但仍必须证明调用者读取过当前版本与远端 blob。
 * 数据如何流动：unknown 只允许 expected_version 与 expected_sha，返回给统一 GitHub mutation 流程做双重比较。
 * 何时失败：字段缺失、版本非正整数、SHA 非完整十六进制或出现额外字段时返回 VALIDATION_FAILED。
 * 如何排查：先执行 entry get，复制返回的 entry.version 与 sha 后重试。
 * 什么不能改：不能把任一护栏设为可选，也不能从当前远端值自动填充后继续写入。
 */
export function parseMutationGuard(input: unknown): MutationGuard {
  const parsed = mutationGuardSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "写操作并发护栏校验失败", parsed.error.issues);
  }
  return parsed.data;
}

/**
 * 为下一内容版本生成严格递增的 UTC 更新时间。
 *
 * 为什么存在：维护者机器时钟可能回拨或两次操作落在同一毫秒，直接使用 now 会让 updatedAt 不变或倒退，破坏审计排序。
 * 数据如何流动：取调用时钟与 current.updatedAt+1ms 的较大值，再输出 Entry Schema 要求的标准 UTC ISO 字符串。
 * 何时失败：now 是 Invalid Date 时返回 VALIDATION_FAILED；current.updatedAt 已由 Entry Schema 保证有效。
 * 如何排查：检查系统时间；即使本机暂时落后，函数也只推进 1ms，不会回写历史时间。
 * 什么不能改：不能允许相同或更早的 updatedAt，也不能修改 addedAt 来掩盖时钟问题。
 */
function nextUpdatedAt(current: Entry, now: Date): string {
  const nowTime = now.getTime();
  if (Number.isNaN(nowTime)) {
    throw new AppError("VALIDATION_FAILED", "系统时间无效");
  }
  return new Date(Math.max(nowTime, Date.parse(current.updatedAt) + 1)).toISOString();
}

/**
 * 依据 Merge Patch 生成下一个领域版本，不接触文件或 GitHub。
 *
 * 为什么存在：字段缺失保持、出现替换、null 清空可选字段和数组整体替换必须成为单一领域规则，不能散落在 CLI 与 adapter。
 * 数据如何流动：已校验 request 与当前 Entry 合并；标签重新 canonicalize，系统递增 version/updatedAt，最后完整 Entry Schema 复验。
 * 何时失败：旧 expected_version、回收态更新、规范化失败、无实际内容变化或合并后 Schema 非法时抛出稳定领域错误。
 * 如何排查：冲突先重新 get；回收条目先 restore；无变化请求应删除未改变字段而不是制造空 commit。
 * 什么不能改：id、addedAt 与 status 在 update 中不可变；version 必须严格加一，不能接受调用者指定的新版本或时间。
 */
export function applyEntryUpdate(
  current: Entry,
  request: UpdateEntryRequest,
  now = new Date(),
): Entry {
  if (current.version !== request.expected_version) {
    throw new AppError("VERSION_CONFLICT", "条目内容版本已变化", {
      expected_version: request.expected_version,
      actual_version: current.version,
    });
  }
  if (current.status !== "published") {
    throw new AppError("VALIDATION_FAILED", "回收条目必须先恢复后才能修改", {
      id: current.id,
      status: current.status,
    });
  }

  const patch = request.patch;
  const mutableBefore = {
    title: current.title,
    summary: current.summary,
    category: current.category,
    tags: current.tags,
    rating: current.rating,
    source: current.source,
    references: current.references,
    personalTake: current.personalTake,
  };
  const mutableAfter = {
    title: patch.title ?? current.title,
    summary: patch.summary ?? current.summary,
    category: patch.category ?? current.category,
    tags: patch.tags === undefined ? current.tags : normalizeTags(patch.tags),
    rating: patch.rating === undefined ? current.rating : patch.rating,
    source: patch.source === undefined ? current.source : patch.source,
    references: patch.references ?? current.references,
    personalTake:
      patch.personal_take === undefined ? current.personalTake : patch.personal_take.trim(),
  };
  if (JSON.stringify(mutableBefore) === JSON.stringify(mutableAfter)) {
    throw new AppError("VALIDATION_FAILED", "update 没有产生实际内容变化", { id: current.id });
  }

  const parsed = entrySchema.safeParse({
    ...current,
    ...mutableAfter,
    version: current.version + 1,
    updatedAt: nextUpdatedAt(current, now),
  });
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "更新后的条目校验失败", parsed.error.issues);
  }
  return parsed.data;
}

/**
 * 通过原位状态切换生成回收或恢复版本。
 *
 * 为什么存在：第一阶段禁止永久删除，delete/restore 只能保留同一文件并改变 published/recycled，同时递增审计版本。
 * 数据如何流动：先校验 expected_version 与当前状态，再保留全部内容字段，只替换 status、version 和 updatedAt 并复验 Schema。
 * 何时失败：版本过期、delete 已回收条目、restore 已发布条目或系统时间异常时返回 VERSION_CONFLICT/VALIDATION_FAILED。
 * 如何排查：重新 get 核对 status/version；不要用重复的新请求模拟幂等，真正重试应复用原 request ID。
 * 什么不能改：不能删除文件、清空内容、重置 addedAt 或复用旧版本；状态只允许这两个固定值。
 */
export function transitionEntryStatus(
  current: Entry,
  guard: MutationGuard,
  target: EntryStatus,
  now = new Date(),
): Entry {
  if (current.version !== guard.expected_version) {
    throw new AppError("VERSION_CONFLICT", "条目内容版本已变化", {
      expected_version: guard.expected_version,
      actual_version: current.version,
    });
  }
  if (current.status === target) {
    throw new AppError("VALIDATION_FAILED", "条目已经处于目标状态", {
      id: current.id,
      status: target,
    });
  }
  const parsed = entrySchema.safeParse({
    ...current,
    status: target,
    version: current.version + 1,
    updatedAt: nextUpdatedAt(current, now),
  });
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", "状态切换后的条目校验失败", parsed.error.issues);
  }
  return parsed.data;
}
