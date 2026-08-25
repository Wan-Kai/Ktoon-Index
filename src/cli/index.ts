#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Command, CommanderError } from "commander";

import {
  CATEGORY_IDS,
  RATINGS,
  AppError,
  createEntry,
  filterEntries,
  listTags,
  searchEntries,
  serializeEntry,
  type CategoryId,
  type Entry,
  type EntryQueryFilters,
  type EntrySort,
  type Rating,
} from "../content/index.ts";
import { GitHubContentClient, GitHubEntryReader } from "../github/index.ts";
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
 * 从文件或 stdin 读取 create JSON，保证 CLI 不引入交互式隐藏状态。
 *
 * 为什么存在：Agent 写操作只接受结构化 JSON；支持 `--input -` 可让调用者通过管道传入而无需创建临时文件。
 * 数据如何流动：路径读取 UTF-8 或从 fd 0 读取，解析为 unknown 后交给统一 Entry Schema。
 * 何时失败：文件不存在、stdin 为空或 JSON 损坏时返回 `VALIDATION_FAILED`，不会触发 GitHub 请求。
 * 如何排查：先用 JSON 工具检查输入，再确认 `--input` 路径相对当前命令目录而不是仓库目录。
 * 什么不能改：不能接受 YAML、逐字段 flags 或自动修补损坏 JSON；写入契约必须唯一。
 */
function readJsonInput(path: string): unknown {
  try {
    const source = path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
    return JSON.parse(source) as JsonRecord;
  } catch (error) {
    throw new AppError("VALIDATION_FAILED", "无法读取 create JSON", {
      path,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 建立 M2 CLI 命令树。
 *
 * 为什么存在：命令解析与执行要可在测试中注入 GitHub adapter，避免单元测试真实修改远端。
 * 数据如何流动：doctor 检查运行环境；create/get 复用 M1；list/search/tag list 通过 GitHubEntryReader 进入统一查询模块和输出层。
 * 何时失败：领域或 GitHub 层抛出 AppError，由最外层统一输出机器可读错误和非零退出码。
 * 如何排查：先执行 doctor，再根据 error.code 修正输入、认证或远端冲突。
 * 什么不能改：不能让 create/get 直接读写当前工作区，也不能在 commander action 内复制 Schema 规则。
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
    .action((options: { input: string }) => {
      const model = createEntry(readJsonInput(options.input));
      const markdown = serializeEntry(model);
      client.doctor();
      const requestId = randomUUID();
      const result = client.createEntry(model, markdown, requestId);
      writeOutput(
        {
          ok: true,
          command: "entry create",
          request_id: requestId,
          commit_sha: result.commitSha,
          path: result.path,
          entry: model,
        },
        "json",
      );
    });

  entry
    .command("get")
    .description("从固定 GitHub 仓库读取一个条目")
    .argument("<id>", "不可变条目 ID")
    .action((id: string) => {
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
