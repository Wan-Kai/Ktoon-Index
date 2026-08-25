#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Command, CommanderError } from "commander";

import {
  CATEGORY_IDS,
  RATINGS,
  AppError,
  applyEntryUpdate,
  createEntry,
  entryIdSchema,
  filterEntries,
  listTags,
  parseMutationGuard,
  parseUpdateEntryRequest,
  searchEntries,
  serializeEntry,
  transitionEntryStatus,
  type CategoryId,
  type Entry,
  type EntryQueryFilters,
  type EntrySort,
  type Rating,
} from "../content/index.ts";
import {
  GitHubContentClient,
  GitHubEntryReader,
  assertRequestId,
  type GitHubWriteResult,
  type WriteOperation,
} from "../github/index.ts";
import { runDoctor } from "./doctor.ts";
import { parseOutputFormat, writeOutput, type OutputFormat, type TableRow } from "./output.ts";

type JsonRecord = Record<string, unknown>;

type ReadOptions = {
  category?: string;
  tag?: string[];
  rating?: string;
  addedAfter?: string;
  addedBefore?: string;
  sort?: string;
  format?: string;
};

type WriteOptions = { input: string; requestId?: string };

/**
 * 给所有条目读取命令挂载同一组筛选和输出参数。
 *
 * 为什么存在：list 与 search 的命令表面必须一致，否则 Agent 会为同一查询语义维护两套参数协议。
 * 数据如何流动：Commander 只收集原始字符串，parseReadOptions 与领域查询层随后在任何网络请求前完成校验和解释。
 * 何时失败：本函数不执行校验；缺失参数值由 Commander 失败，非法值由后续统一转换为 VALIDATION_FAILED。
 * 如何排查：比较两个命令的 help 输出，并确认新增筛选同时出现在 list 与 search，不能只改其中一处。
 * 什么不能改：不能在这里访问 GitHub、规范化标签或实现筛选；它只定义稳定的 CLI 参数表面。
 */
function addReadOptions(command: Command): Command {
  return command
    .option("--category <category>", "按固定分类筛选")
    .option("--tag <tags...>", "按一个或多个标签筛选；多个标签为 AND")
    .option("--rating <rating>", "按夯、人上人、NPC 或 unrated 筛选")
    .option("--added-after <time>", "录入时间下界，包含端点")
    .option("--added-before <time>", "录入时间上界，包含端点")
    .option("--sort <sort>", "rating 或 added_at", "rating")
    .option("--format <format>", "json 或 table", "json");
}

/**
 * 把 Commander 字符串参数转换为领域查询过滤器。
 *
 * 为什么存在：未知分类、评分、排序和格式必须在 GitHub 请求前失败，且 CLI 不能复制 query.ts 的实际筛选逻辑。
 * 数据如何流动：枚举参数做白名单映射，unrated 转为 null，标签与时间保持原值交给领域层统一规范化和解析。
 * 何时失败：任一枚举未知时抛出 VALIDATION_FAILED；格式由 parseOutputFormat 单独校验。
 * 如何排查：参考命令 help 中的允许值，时间使用 ISO 或 YYYY-MM-DD。
 * 什么不能改：不能静默回退默认分类/评分，也不能在这里实现字符串搜索或排序比较。
 */
function parseReadOptions(options: ReadOptions): {
  filters: EntryQueryFilters;
  format: OutputFormat;
} {
  if (options.category && !CATEGORY_IDS.includes(options.category as CategoryId)) {
    throw new AppError("VALIDATION_FAILED", "未知分类", { value: options.category });
  }
  let rating: Rating | null | undefined;
  if (options.rating === "unrated") rating = null;
  else if (options.rating && RATINGS.includes(options.rating as Rating))
    rating = options.rating as Rating;
  else if (options.rating) {
    throw new AppError("VALIDATION_FAILED", "未知评分", { value: options.rating });
  }
  if (options.sort && options.sort !== "rating" && options.sort !== "added_at") {
    throw new AppError("VALIDATION_FAILED", "未知排序方式", { value: options.sort });
  }
  return {
    filters: {
      category: options.category as CategoryId | undefined,
      tags: options.tag,
      rating,
      addedAfter: options.addedAfter,
      addedBefore: options.addedBefore,
      sort: options.sort as EntrySort | undefined,
    },
    format: parseOutputFormat(options.format),
  };
}

/**
 * 用空数据预跑领域查询，只验证请求而不产生结果或访问网络。
 *
 * 为什么存在：时间、标签和空搜索词由领域层定义，CLI 又必须保证非法参数在 doctor 或 GitHub list 之前失败。
 * 数据如何流动：list 只调用 filterEntries；search 传入 query 调用 searchEntries；两者在真实远端数据到达后会以同一参数再执行一次得到结果。
 * 何时失败：领域层发现非法标签、时间边界或空 query 时立即抛出 VALIDATION_FAILED，此时 adapter 调用次数必须为零。
 * 如何排查：若失败仍触发网络，检查 action 中本函数是否位于 client.doctor 前；若规则不一致，只能修改领域查询，不能在 CLI 打补丁。
 * 什么不能改：不能把预检移到 reader.listEntries 之后，也不能复制 parseBoundary 或 normalizeTags 的实现来避免双执行。
 */
function validateReadRequest(filters: EntryQueryFilters, query?: string): void {
  if (query === undefined) filterEntries([], filters);
  else searchEntries([], query, filters);
}

function entryTableRows(entries: Entry[]): TableRow[] {
  return entries.map((entry) => ({
    ID: entry.id,
    CATEGORY: entry.category,
    RATING: entry.rating ?? "unrated",
    TITLE: entry.title,
    ADDED_AT: entry.addedAt,
  }));
}

/**
 * 从文件或 stdin 读取任一写操作 JSON，保证 CLI 不引入交互式隐藏状态。
 *
 * 为什么存在：create、update、delete、restore 只接受结构化 JSON；支持 `--input -` 可让调用者通过管道传入而无需创建临时文件。
 * 数据如何流动：路径读取 UTF-8 或从 fd 0 读取，解析为 unknown 后分别交给创建、Merge Patch 或并发护栏 Schema。
 * 何时失败：文件不存在、stdin 为空或 JSON 损坏时返回 `VALIDATION_FAILED`，不会触发 GitHub 请求。
 * 如何排查：先用 JSON 工具检查输入，再确认 `--input` 路径相对当前命令目录而不是仓库目录。
 * 什么不能改：不能接受 YAML、逐字段 flags 或自动修补损坏 JSON；写入契约必须唯一。
 */
function readJsonInput(path: string): unknown {
  try {
    const source = path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
    return JSON.parse(source) as JsonRecord;
  } catch (error) {
    throw new AppError("VALIDATION_FAILED", "无法读取写操作 JSON", {
      path,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 为一次写操作生成或校验可重试的 request ID。
 *
 * 为什么存在：默认调用应零配置获得 UUID；遇到超时的 Agent 又必须能够显式复用原 ID，让 GitHub 历史返回原 commit 而不是重复写入。
 * 数据如何流动：缺失值由 randomUUID 生成，显式值原样进入统一 UUID 校验，随后传给 commit trailer 与 CLI JSON 输出。
 * 何时失败：显式值不是标准 UUID 时在 doctor 和任何 GitHub 请求前返回 VALIDATION_FAILED。
 * 如何排查：省略 `--request-id`，或复用上一次调用保存的 request_id；不能临时修改旧 ID 的字符。
 * 什么不能改：不能用时间戳、随机短串或静默 trim；request ID 是全仓库幂等键和审计边界。
 */
function resolveRequestId(value: string | undefined): string {
  const requestId = value ?? randomUUID();
  assertRequestId(requestId);
  return requestId;
}

/**
 * 在 doctor 前把路径参数收敛为不可变 Entry ID。
 *
 * 为什么存在：get/update/delete/restore 都把 ID 放在 CLI 路径参数中，非法值不应先触发认证或提交历史请求。
 * 数据如何流动：原始参数复用 entryIdSchema；成功后后续层仍会防御性复验，失败统一转换为 VALIDATION_FAILED。
 * 何时失败：大写、空格、目录穿越、连续/首尾连字符或非 ASCII ID 在零网络调用时失败。
 * 如何排查：从 entry get/list 复制现有 ID，或使用小写字母、数字和单个连字符。
 * 什么不能改：不能在 CLI 单独维护另一条 ID 正则，也不能自动 slugify 修改已有条目的路径参数。
 */
function assertEntryId(id: string): void {
  if (!entryIdSchema.safeParse(id).success) {
    throw new AppError("VALIDATION_FAILED", "ID 格式不合法", { id });
  }
}

/**
 * 把四种写操作收敛为同一份机器可读成功回执。
 *
 * 为什么存在：Agent 恢复超时需要统一读取 request/commit/blob SHA 与 idempotent，不能为 create/update/status 分别猜字段。
 * 数据如何流动：GitHubWriteResult 只做 snake_case 投影后一次写到 stdout，领域 Entry 原样保留供下一次 expected_version 使用。
 * 何时失败：本函数不执行网络与校验；若 result 缺字段，GitHub client 应在返回前失败而不是输出部分回执。
 * 如何排查：核对 commit_sha、sha、request_id 和 entry.version；idempotent=true 表示返回历史结果且没有新 commit。
 * 什么不能改：不能省略 SHA/version 或把幂等命中伪装成新写入，也不能在成功 JSON 中泄漏认证信息。
 */
function writeMutationResult(result: GitHubWriteResult): void {
  writeOutput(
    {
      ok: true,
      command: `entry ${result.operation}`,
      request_id: result.requestId,
      commit_sha: result.commitSha,
      sha: result.sha,
      path: result.path,
      idempotent: result.idempotent,
      entry: result.entry,
    },
    "json",
  );
}

/**
 * 建立 M3 CLI 命令树。
 *
 * 为什么存在：命令解析与执行要可在测试中注入 GitHub adapter，避免单元测试真实修改远端。
 * 数据如何流动：doctor 与只读命令复用 M2；create/update/delete/restore 先在本地解析 JSON 和 request ID，再进入 GitHub 单文件 CAS/幂等写路径。
 * 何时失败：领域或 GitHub 层抛出 AppError，由最外层统一输出机器可读错误和非零退出码。
 * 如何排查：先执行 doctor，再根据 error.code 修正输入、认证或远端冲突。
 * 什么不能改：不能让任一命令直接读写当前工作区，不能在 commander action 内复制 Schema/并发规则，也不能加入批量或永久删除入口。
 */
export function createProgram(client = new GitHubContentClient()): Command {
  const program = new Command();
  const reader = new GitHubEntryReader(client);
  program
    .name("ai-index")
    .description("Ktoon Index 内容维护 CLI")
    .version(
      (
        JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
          version: string;
        }
      ).version,
    )
    .exitOverride()
    .configureOutput({
      // Commander 参数错误由 runCli 统一输出 JSON，禁止先混入一段不可解析的纯文本。
      writeErr: () => undefined,
      outputError: () => undefined,
    });

  program
    .command("doctor")
    .description("检查 Node、gh 权限和内容构建能力")
    .action(() => {
      writeOutput({ ok: true, command: "doctor", checks: runDoctor(client) }, "json");
    });

  const entry = program.command("entry").description("管理单个条目");
  entry
    .command("create")
    .description("从 JSON 创建并直接提交一个条目")
    .requiredOption("--input <path>", "JSON 文件路径；使用 - 从 stdin 读取")
    .option("--request-id <uuid>", "重试时复用的 request ID")
    .action((options: WriteOptions) => {
      const model = createEntry(readJsonInput(options.input));
      const markdown = serializeEntry(model);
      const requestId = resolveRequestId(options.requestId);
      client.doctor();
      const result = client.createEntry(model, markdown, requestId);
      writeMutationResult(result);
    });

  entry
    .command("get")
    .description("从固定 GitHub 仓库读取一个条目")
    .argument("<id>", "不可变条目 ID")
    .action((id: string) => {
      assertEntryId(id);
      client.doctor();
      const result = client.getEntry(id);
      writeOutput(
        {
          ok: true,
          command: "entry get",
          sha: result.sha,
          path: result.path,
          entry: result.entry,
        },
        "json",
      );
    });

  /**
   * 为 update/delete/restore 建立共享的 JSON、并发与幂等命令外壳。
   *
   * 为什么存在：三种 mutation 只有领域变换不同，输入读取、request ID、doctor、CAS 与输出若复制会逐渐产生安全差异。
   * 数据如何流动：id/options 先本地解析；update 读取 patch，状态操作读取 guard；随后统一调用 client.mutateEntry，并注入对应纯领域函数。
   * 何时失败：JSON/request 非法在网络前失败；远端版本/SHA、状态或写入冲突由领域与 client 返回稳定 AppError。
   * 如何排查：先 get 最新 entry.version/sha，再检查输入文件与复用的 request ID；不要绕过 helper 单独挂 action。
   * 什么不能改：不能让 delete 删除文件、让 restore 重建新 ID，或为任何命令省略 expected_version/expected_sha。
   */
  const addMutationCommand = (
    operation: Exclude<WriteOperation, "create">,
    description: string,
  ): void => {
    entry
      .command(operation)
      .description(description)
      .argument("<id>", "不可变条目 ID")
      .requiredOption("--input <path>", "JSON 文件路径；使用 - 从 stdin 读取")
      .option("--request-id <uuid>", "重试时复用的 request ID")
      .action((id: string, options: WriteOptions) => {
        assertEntryId(id);
        const raw = readJsonInput(options.input);
        const requestId = resolveRequestId(options.requestId);
        const request =
          operation === "update" ? parseUpdateEntryRequest(raw) : parseMutationGuard(raw);
        client.doctor();
        const result = client.mutateEntry(
          {
            id,
            expectedVersion: request.expected_version,
            expectedSha: request.expected_sha,
            requestId,
            operation,
          },
          (current) =>
            operation === "update"
              ? applyEntryUpdate(current, request as ReturnType<typeof parseUpdateEntryRequest>)
              : transitionEntryStatus(
                  current,
                  request,
                  operation === "delete" ? "recycled" : "published",
                ),
        );
        writeMutationResult(result);
      });
  };

  addMutationCommand("update", "用 Merge Patch 修改一个条目");
  addMutationCommand("delete", "原位回收一个条目");
  addMutationCommand("restore", "恢复一个已回收条目");

  addReadOptions(entry.command("list").description("列出远端 Markdown 条目")).action(
    (options: ReadOptions) => {
      const { filters, format } = parseReadOptions(options);
      validateReadRequest(filters);
      client.doctor();
      const entries = filterEntries(reader.listEntries(), filters);
      writeOutput(
        { ok: true, command: "entry list", count: entries.length, entries },
        format,
        entryTableRows(entries),
      );
    },
  );

  addReadOptions(
    entry
      .command("search")
      .description("按标题和摘要搜索远端 Markdown 条目")
      .argument("<query>", "字符串查询"),
  ).action((query: string, options: ReadOptions) => {
    const { filters, format } = parseReadOptions(options);
    validateReadRequest(filters, query);
    client.doctor();
    const results = searchEntries(reader.listEntries(), query, filters);
    writeOutput(
      { ok: true, command: "entry search", query, count: results.length, results },
      format,
      results.map(({ entry, score }) => ({ SCORE: score, ...entryTableRows([entry])[0] })),
    );
  });

  const tag = program.command("tag").description("读取动态标签");
  tag
    .command("list")
    .description("从远端 Markdown 条目枚举标签")
    .option("--format <format>", "json 或 table", "json")
    .action((options: { format?: string }) => {
      const format = parseOutputFormat(options.format);
      client.doctor();
      const tags = listTags(reader.listEntries());
      writeOutput(
        { ok: true, command: "tag list", count: tags.length, tags },
        format,
        tags.map((value) => ({ TAG: value })),
      );
    });

  return program;
}

/**
 * 将领域、GitHub 与 Commander 失败收敛为稳定 JSON。
 *
 * 为什么存在：Agent 必须只解析一种输出契约；Commander 默认纯文本与栈信息会让自动恢复不可靠。
 * 数据如何流动：AppError 原样保留；参数错误映射为 VALIDATION_FAILED；未知异常映射为 GITHUB_ERROR，最终只写 stderr JSON。
 * 何时失败：本函数自身只做序列化；若 details 未来出现不可序列化值，测试必须先阻止其进入错误边界。
 * 如何排查：读取 error.code 与 details；禁止为排查而输出进程环境或 gh token。
 * 什么不能改：不能把 Commander 原始纯文本与 JSON 混写，也不能在这里吞掉非零退出码。
 */
function writeFailure(error: unknown): void {
  const appError =
    error instanceof AppError
      ? error
      : error instanceof CommanderError
        ? new AppError("VALIDATION_FAILED", "CLI 参数错误", {
            commander_code: error.code,
            reason: error.message,
          })
        : new AppError("GITHUB_ERROR", "CLI 执行失败", {
            reason: error instanceof Error ? error.message : String(error),
          });
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: { code: appError.code, message: appError.message, details: appError.details } }, null, 2)}\n`,
  );
  process.exitCode = 1;
}

/**
 * 执行一次 CLI 调用并保证帮助、版本与失败退出语义正确。
 *
 * 为什么存在：bin 与 npm script 必须复用同一入口，且 Commander 的 exitOverride 需要在最外层区分正常帮助和真实参数错误。
 * 数据如何流动：argv 进入 createProgram；正常命令输出 JSON，help/version 保留 Commander stdout，其他异常进入 writeFailure。
 * 何时失败：命令 action、参数解析或 adapter 抛错时设置 exitCode=1；函数不让未处理 Promise 逃逸。
 * 如何排查：先复现完整 argv，再检查 stderr 是否为单个 JSON 对象和对应 error.code。
 * 什么不能改：不能在 bin 中另建命令树，也不能让 help/version 被错误标成失败。
 */
export async function runCli(argv = process.argv): Promise<void> {
  try {
    await createProgram().parseAsync(argv);
  } catch (error) {
    if (
      error instanceof CommanderError &&
      (error.code === "commander.helpDisplayed" || error.code === "commander.version")
    ) {
      return;
    }
    writeFailure(error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runCli();
}
