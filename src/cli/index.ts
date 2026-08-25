#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Command, CommanderError } from "commander";

import { AppError, createEntry, serializeEntry } from "../content/index.ts";
import { GitHubContentClient } from "../github/index.ts";

type JsonRecord = Record<string, unknown>;

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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
 * 建立 M1 最小 CLI 命令树。
 *
 * 为什么存在：命令解析与执行要可在测试中注入 GitHub adapter，避免单元测试真实修改远端。
 * 数据如何流动：doctor 只读检查认证；create 读取 JSON、建模、序列化后提交单文件；get 从远端解析同一 Markdown。
 * 何时失败：领域或 GitHub 层抛出 AppError，由最外层统一输出机器可读错误和非零退出码。
 * 如何排查：先执行 doctor，再根据 error.code 修正输入、认证或远端冲突。
 * 什么不能改：不能让 create/get 直接读写当前工作区，也不能在 commander action 内复制 Schema 规则。
 */
export function createProgram(client = new GitHubContentClient()): Command {
  const program = new Command();
  program
    .name("ai-index")
    .description("Ktoon Index 内容维护 CLI")
    .version("0.1.0")
    .exitOverride()
    .configureOutput({
      // Commander 参数错误由 runCli 统一输出 JSON，禁止先混入一段不可解析的纯文本。
      writeErr: () => undefined,
      outputError: () => undefined,
    });

  program
    .command("doctor")
    .description("检查 gh 认证和固定仓库权限")
    .action(() => {
      writeJson({ ok: true, command: "doctor", checks: client.doctor() });
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
      writeJson({
        ok: true,
        command: "entry create",
        request_id: requestId,
        commit_sha: result.commitSha,
        path: result.path,
        entry: model,
      });
    });

  entry
    .command("get")
    .description("从固定 GitHub 仓库读取一个条目")
    .argument("<id>", "不可变条目 ID")
    .action((id: string) => {
      client.doctor();
      const result = client.getEntry(id);
      writeJson({
        ok: true,
        command: "entry get",
        sha: result.sha,
        path: result.path,
        entry: result.entry,
      });
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
