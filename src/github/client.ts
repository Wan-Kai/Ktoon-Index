import { spawnSync } from "node:child_process";

import {
  AppError,
  entryIdSchema,
  parseEntry,
  serializeEntry,
  type Entry,
  type EntryReader,
} from "../content/index.ts";

export const GITHUB_OWNER = "Wan-Kai";
export const GITHUB_REPOSITORY = "Ktoon-Index";
export const GITHUB_BRANCH = "main";

type GhResult = { stdout: string; stderr: string; status: number };
export type GhRunner = (args: string[], input?: string) => GhResult;

export type RemoteEntry = {
  entry: Entry;
  sha: string;
  path: string;
};

export type WriteOperation = "create" | "update" | "delete" | "restore";

export type GitHubWriteResult = RemoteEntry & {
  commitSha: string;
  requestId: string;
  operation: WriteOperation;
  idempotent: boolean;
};

type RequestCommit = {
  sha: string;
  requestId: string;
  operation: WriteOperation;
  entryId: string;
  version: number;
};

type MutationOptions = {
  id: string;
  expectedVersion: number;
  expectedSha: string;
  requestId: string;
  operation: Exclude<WriteOperation, "create">;
};

/**
 * 通过参数数组执行 gh，禁止 shell 插值进入认证与仓库写入链路。
 *
 * 为什么存在：CLI 要复用维护者现有 `gh auth`，同时避免把 JSON、路径或 commit message 拼成可执行 shell 字符串。
 * 数据如何流动：参数直接交给 spawnSync，JSON 请求体只从 stdin 输入，stdout/stderr 原样返回给上层映射稳定错误码。
 * 何时失败：gh 不存在、认证过期、网络失败或进程退出非零时由上层根据 stderr 判定。
 * 如何排查：先运行 `gh auth status`，再复制错误 details 中的 args 手工执行只读请求。
 * 什么不能改：不能启用 `shell: true`，不能打印 token，也不能回退到本地 git 写文件。
 */
export const defaultGhRunner: GhRunner = (args, input) => {
  const result = spawnSync("gh", args, {
    input,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
    status: result.status ?? 1,
  };
};

function repositoryEndpoint(path = ""): string {
  return `repos/${GITHUB_OWNER}/${GITHUB_REPOSITORY}${path}`;
}

function entryPath(id: string): string {
  return `content/entries/${id}.md`;
}

function isNotFound(result: GhResult): boolean {
  return result.status !== 0 && /(?:HTTP 404|Not Found)/iu.test(result.stderr);
}

/**
 * 在任何历史查询或写请求前校验幂等 request ID。
 *
 * 为什么存在：request ID 会进入 commit trailer 与历史匹配，必须是无换行、不可伪造其他 trailer 的稳定 UUID。
 * 数据如何流动：CLI 生成或接收字符串后调用本函数；GitHub client 在每次内部查找前再次防御性调用。
 * 何时失败：非标准 UUID、控制字符、空值或任意附加文本返回 VALIDATION_FAILED，且不访问网络。
 * 如何排查：省略参数让 CLI 自动生成，或使用标准 UUID v1-v8；不要复用其他操作的 ID。
 * 什么不能改：不能接受任意字符串或只做 trim，否则 commit message 注入会破坏幂等与审计边界。
 */
export function assertRequestId(requestId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(requestId)
  ) {
    throw new AppError("VALIDATION_FAILED", "request ID 必须是 UUID", { request_id: requestId });
  }
}

/**
 * 把 GitHub stdout 解析为预期 JSON，并收敛损坏响应的错误契约。
 *
 * 为什么存在：gh 成功退出不代表响应一定可解析；SyntaxError 若直接逃逸会绕过稳定 GITHUB_ERROR 和排查上下文。
 * 数据如何流动：原始 stdout 只在内存中 JSON.parse，成功按调用方类型返回，失败记录操作名称与解析原因但不回显潜在敏感全文。
 * 何时失败：空响应、截断 JSON 或 GitHub/扩展输出污染 stdout 时返回 GITHUB_ERROR。
 * 如何排查：用同一只读 gh api 命令检查原始响应与扩展配置；禁止把 token 或完整内容加入 details。
 * 什么不能改：不能 eval、宽松修补 JSON 或在解析失败后猜默认对象继续写入。
 */
function parseGitHubJson<T>(result: GhResult, operation: string): T {
  try {
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    throw new AppError("GITHUB_ERROR", `${operation}响应不是有效 JSON`, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 生成唯一写入格式的 commit subject 与四项审计 trailers。
 *
 * 为什么存在：幂等恢复、人工审计和未来 Skill 都依赖稳定 trailers，若各操作自行拼接会出现无法检索的历史。
 * 数据如何流动：已校验 operation、Entry 与 UUID 被编码为固定六行文本，直接进入 Contents API message 字段。
 * 何时失败：函数本身不抛错；调用前 Entry/request 已校验，GitHub 拒绝 message 时由写路径处理。
 * 如何排查：查看远端 commit 原文，四个 trailer 必须位于最后一个段落且各占一行。
 * 什么不能改：不能重命名 trailer、加入用户可控换行或把 request ID 只放 subject，否则历史匹配会失效。
 */
function commitMessage(operation: WriteOperation, entry: Entry, requestId: string): string {
  return [
    `content: ${operation} ${entry.id}`,
    "",
    `Operation: ${operation}`,
    `Entry-ID: ${entry.id}`,
    `Content-Version: ${entry.version}`,
    `Request-ID: ${requestId}`,
  ].join("\n");
}

/**
 * 只从 commit 最后一个段落精确读取受控 trailer。
 *
 * 为什么存在：在整段 message 中模糊搜索可能把正文示例误认为 request ID，造成错误幂等命中或跨操作拒绝。
 * 数据如何流动：按空行取最后段落，再匹配完整 `Name: ` 行前缀并返回去空白值；不存在则返回 undefined。
 * 何时失败：本函数不抛错；缺失/损坏值由 findRequestCommit 统一判为 GITHUB_ERROR。
 * 如何排查：确认 trailers 是 commit 的最后段落，没有在它们之间插入空行或改名。
 * 什么不能改：不能回退 includes/正则全文搜索，也不能把正文中的同名字段视为审计 trailer。
 */
function trailer(message: string, name: string): string | undefined {
  const trailerBlock =
    message
      .trim()
      .split(/\n\s*\n/gu)
      .at(-1) ?? "";
  return trailerBlock
    .split("\n")
    .find((line) => line.startsWith(`${name}: `))
    ?.slice(name.length + 2)
    .trim();
}

/**
 * 把 GitHub 权限失败与普通 API/网络失败分成可恢复错误码。
 *
 * 为什么存在：Agent 面对 FORBIDDEN 应停止重试并修复权限，面对 GITHUB_ERROR 才适合检查网络或服务状态。
 * 数据如何流动：只检查 gh 已脱敏的 stderr 状态描述，不读取 token 或进程环境。
 * 何时失败：GitHub 改变错误文本时可能回落为 GITHUB_ERROR，但不会误授予权限或继续写入。
 * 如何排查：对照 gh 命令退出码和 GitHub HTTP 状态，必要时扩充明确的状态匹配测试。
 * 什么不能改：不能把未知失败默认成 FORBIDDEN，也不能通过重跑写请求来猜测错误类型。
 */
function errorCodeFor(result: GhResult): "FORBIDDEN" | "GITHUB_ERROR" {
  return /(?:HTTP 403|Forbidden)/iu.test(result.stderr) ? "FORBIDDEN" : "GITHUB_ERROR";
}

/**
 * 固定项目的 GitHub 内容与受控写入客户端。
 *
 * 为什么存在：内容模块不应知道 GitHub 命令细节；M3 的全历史幂等、版本/SHA CAS 和单文件 commit 必须在一个 adapter 内强制。
 * 数据如何流动：读取固定 main/历史 ref；写入先扫 request 历史、校验当前版本与 blob SHA，再用 Contents PUT 修改唯一 Markdown 并在不确定响应后恢复。
 * 何时失败：认证、权限、网络、历史形状/审计不一致、ID/版本冲突或 GitHub API 异常都会变成稳定 AppError。
 * 如何排查：先 doctor/get，再按 request ID 检查 commit trailers、files 与历史文件；禁止为排查直接重放新写请求。
 * 什么不能改：不能接受任意 owner/repo/branch、创建 PR、写本地工作区、一次改多文件或自动合并版本冲突。
 */
export class GitHubContentClient {
  constructor(private readonly runGh: GhRunner = defaultGhRunner) {}

  /**
   * 检查当前 gh 身份是否能写固定仓库 main。
   *
   * 为什么存在：create/get 前要尽早区分本地认证问题与内容问题，避免把 401/403 混成普通 GitHub 失败。
   * 数据如何流动：先执行本机 gh auth status，再读取固定仓库 default_branch 与当前身份 permissions.push。
   * 何时失败：gh 未登录返回 AUTH_REQUIRED；仓库不可读、分支不符或没有 push 权限返回 FORBIDDEN/GITHUB_ERROR。
   * 如何排查：运行 `gh auth status` 与只读 `gh api repos/Wan-Kai/Ktoon-Index`，不要打印 token。
   * 什么不能改：不能只相信本地 git remote，也不能允许调用者传入另一个仓库或分支。
   */
  doctor(): { authenticated: true; repository: string; branch: string; writable: true } {
    const auth = this.runGh(["auth", "status"]);
    if (auth.status !== 0) {
      throw new AppError("AUTH_REQUIRED", "gh 尚未登录或认证已失效", {
        stderr: auth.stderr.trim(),
      });
    }

    const repo = this.runGh(["api", repositoryEndpoint(), "--jq", "{default_branch,permissions}"]);
    if (repo.status !== 0) {
      const code = errorCodeFor(repo);
      throw new AppError(code, "无法读取固定 GitHub 仓库", { stderr: repo.stderr.trim() });
    }
    const data = parseGitHubJson<{
      default_branch?: string;
      permissions?: { push?: boolean };
    }>(repo, "GitHub 仓库");
    if (data.default_branch !== GITHUB_BRANCH || data.permissions?.push !== true) {
      throw new AppError("FORBIDDEN", "当前身份没有固定仓库 main 的写权限", data);
    }

    return {
      authenticated: true,
      repository: `${GITHUB_OWNER}/${GITHUB_REPOSITORY}`,
      branch: GITHUB_BRANCH,
      writable: true,
    };
  }

  /**
   * 从 GitHub Contents API 读取并校验一份权威条目。
   *
   * 为什么存在：get、create 判重和后续版本写入必须共享同一远端解析路径，不能读取本地工作区副本。
   * 数据如何流动：统一 ID Schema 生成固定内容路径，GET main 上的 base64 内容，解码后交给 parseEntry，并返回文件 SHA。
   * 何时失败：ID 非法、404、API 异常、响应编码异常或 Markdown 损坏时抛出稳定 AppError。
   * 如何排查：先 doctor，再用只读 gh api 检查路径；Markdown 错误按内容模块提示修复。
   * 什么不能改：不能接受目录穿越、自动回退本地文件或忽略 parseEntry 错误。
   */
  getEntry(id: string): RemoteEntry {
    return this.getEntryAtRef(id, GITHUB_BRANCH);
  }

  /**
   * 从指定 commit 或 main 读取同一路径，用于普通 get 与幂等重放。
   *
   * 为什么存在：相同 request ID 重试必须返回原 commit 当时的版本，不能误返回后来又被修改的 main 内容。
   * 数据如何流动：校验 ID 后通过 Contents API 读取 ref，解码并执行完整 Markdown/Schema 校验，保留 blob SHA 和固定路径。
   * 何时失败：ID 非法、ref/path 不存在、API/编码异常或历史 Markdown 损坏时抛出稳定 AppError。
   * 如何排查：普通读取检查 main；幂等读取检查 commit SHA 是否仍存在及该 commit 的 trailers/path。
   * 什么不能改：不能在幂等场景回退 main，也不能跳过历史内容校验后只返回 commit 元数据。
   */
  private getEntryAtRef(id: string, ref: string): RemoteEntry {
    if (!entryIdSchema.safeParse(id).success) {
      throw new AppError("VALIDATION_FAILED", "ID 格式不合法", { id });
    }
    const path = entryPath(id);
    const result = this.runGh([
      "api",
      "--method",
      "GET",
      repositoryEndpoint(`/contents/${path}`),
      "-f",
      `ref=${ref}`,
    ]);
    if (isNotFound(result)) throw new AppError("NOT_FOUND", "条目不存在", { id });
    if (result.status !== 0) {
      throw new AppError("GITHUB_ERROR", "读取 GitHub 条目失败", { stderr: result.stderr.trim() });
    }

    const response = parseGitHubJson<{
      content: string;
      encoding: string;
      sha: string;
    }>(result, "GitHub 内容");
    if (response.encoding !== "base64" || !response.sha) {
      throw new AppError("GITHUB_ERROR", "GitHub 内容响应格式异常", { id });
    }
    const source = Buffer.from(response.content.replace(/\n/gu, ""), "base64").toString("utf8");
    return { entry: parseEntry(source), sha: response.sha, path };
  }

  /**
   * 在固定仓库完整提交历史中查找 request ID，并解析受控 commit trailers。
   *
   * 为什么存在：Contents PUT 可能已在 GitHub 成功而客户端超时；重试必须识别原 commit，避免第二次版本递增和重复提交。
   * 数据如何流动：分页读取 main 的全部 commits，精确匹配 Request-ID trailer，再解析 operation、entry ID 与 content version；零条返回 undefined。
   * 何时失败：API/JSON 异常、同一 request ID 出现多次、trailers 损坏或字段非法时返回 GITHUB_ERROR。
   * 如何排查：用只读 commits API 搜索 Request-ID，核对四个 trailer 与唯一 commit SHA，禁止直接重放写请求猜测结果。
   * 什么不能改：不能只检查最近一页、模糊匹配 message 正文或把重复 request ID 任意选一条。
   */
  private findRequestCommit(requestId: string): RequestCommit | undefined {
    assertRequestId(requestId);
    const result = this.runGh([
      "api",
      "--method",
      "GET",
      repositoryEndpoint("/commits"),
      "-f",
      `sha=${GITHUB_BRANCH}`,
      "-f",
      "per_page=100",
      "--paginate",
      "--slurp",
    ]);
    if (result.status !== 0) {
      throw new AppError(errorCodeFor(result), "读取 request ID 历史失败", {
        stderr: result.stderr.trim(),
      });
    }
    const payload = parseGitHubJson<unknown>(result, "GitHub commit 历史");
    if (!Array.isArray(payload)) {
      throw new AppError("GITHUB_ERROR", "GitHub commit 历史响应形状异常");
    }
    const pages = payload.every(Array.isArray) ? payload : [payload];
    const commits = pages.flatMap((page) => page) as Array<{
      sha?: string;
      commit?: { message?: string };
    }>;
    if (
      commits.some(
        (commit) =>
          typeof commit !== "object" ||
          commit === null ||
          typeof commit.sha !== "string" ||
          typeof commit.commit?.message !== "string",
      )
    ) {
      throw new AppError("GITHUB_ERROR", "GitHub commit 历史条目形状异常");
    }
    const matches = commits.filter(
      (commit) => trailer(commit.commit?.message ?? "", "Request-ID") === requestId,
    );
    if (matches.length === 0) return undefined;
    if (matches.length !== 1) {
      throw new AppError("GITHUB_ERROR", "request ID 对应多个 commit", {
        request_id: requestId,
        commits: matches.map((commit) => commit.sha),
      });
    }
    const match = matches[0];
    const message = match.commit?.message ?? "";
    const operation = trailer(message, "Operation");
    const entryId = trailer(message, "Entry-ID");
    const version = Number(trailer(message, "Content-Version"));
    if (
      !match.sha ||
      !["create", "update", "delete", "restore"].includes(operation ?? "") ||
      !entryIdSchema.safeParse(entryId).success ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new AppError("GITHUB_ERROR", "request commit trailers 损坏", {
        request_id: requestId,
        commit: match.sha,
      });
    }
    return {
      sha: match.sha,
      requestId,
      operation: operation as WriteOperation,
      entryId: entryId as string,
      version,
    };
  }

  /**
   * 核对 request commit 确实只修改目标 Markdown 且操作类型与文件状态一致。
   *
   * 为什么存在：trailers 只是声明；若 commit 实际改了其他路径或 create/update 类型不符，仅凭 message 会把伪造历史当成幂等成功。
   * 数据如何流动：读取单个 commit 详情，要求 files 恰好一项、filename 等于固定 entry path，并校验 create=added、其余操作=modified。
   * 何时失败：API/JSON 异常、文件列表缺失、多文件 commit、错误路径或错误 change status 时返回 GITHUB_ERROR。
   * 如何排查：打开 commit Files changed 核对唯一文件及 added/modified；异常历史不能靠修改 trailer 修复。
   * 什么不能改：不能只看 commit subject/trailer，也不能允许额外生成文件或把 rename/remove 解释成合法内容操作。
   */
  private verifyRequestCommit(commit: RequestCommit): void {
    const result = this.runGh([
      "api",
      "--method",
      "GET",
      repositoryEndpoint(`/commits/${commit.sha}`),
    ]);
    if (result.status !== 0) {
      throw new AppError(errorCodeFor(result), "读取 request commit 详情失败", {
        commit: commit.sha,
        stderr: result.stderr.trim(),
      });
    }
    const detail = parseGitHubJson<{
      files?: Array<{ filename?: string; status?: string }>;
    }>(result, "GitHub request commit");
    const expectedFileStatus = commit.operation === "create" ? "added" : "modified";
    if (
      detail.files?.length !== 1 ||
      detail.files[0]?.filename !== entryPath(commit.entryId) ||
      detail.files[0]?.status !== expectedFileStatus
    ) {
      throw new AppError("GITHUB_ERROR", "request commit 实际文件变更与 trailers 不一致", {
        commit: commit.sha,
        operation: commit.operation,
        files: detail.files,
      });
    }
  }

  /**
   * 把历史 request commit 还原为稳定写结果，并阻止 request ID 跨操作复用。
   *
   * 为什么存在：幂等不仅是“不再写”，还必须向调用方返回原 commit、原版本和原 blob SHA，才能可靠恢复超时调用。
   * 数据如何流动：查找 request trailer；若存在则核对 operation/id、commit 唯一文件及 added/modified，再从该 ref 读取 Entry 并核对 ID/version/status。
   * 何时失败：request ID 跨条目/操作复用、commit 多文件/错路径，或历史 Entry 与 trailer 生命周期不一致时返回 VALIDATION_FAILED/GITHUB_ERROR。
   * 如何排查：搜索 Request-ID 对应 commit 并核对 trailers；不要通过更改 expected_version 来强行复用旧 ID。
   * 什么不能改：不能把 request ID 只限定在单文件历史，也不能用当前 main 内容替代原 commit 内容。
   */
  private resolveIdempotent(
    requestId: string,
    id: string,
    operation: WriteOperation,
  ): GitHubWriteResult | undefined {
    const commit = this.findRequestCommit(requestId);
    if (!commit) return undefined;
    if (commit.entryId !== id || commit.operation !== operation) {
      throw new AppError("VALIDATION_FAILED", "request ID 已被其他写操作使用", {
        request_id: requestId,
        expected: { id, operation },
        actual: { id: commit.entryId, operation: commit.operation },
      });
    }
    this.verifyRequestCommit(commit);
    const remote = this.getEntryAtRef(id, commit.sha);
    const expectedStatus = commit.operation === "delete" ? "recycled" : "published";
    if (
      remote.entry.id !== commit.entryId ||
      remote.entry.version !== commit.version ||
      remote.entry.status !== expectedStatus ||
      (commit.operation === "create" && remote.entry.version !== 1)
    ) {
      throw new AppError("GITHUB_ERROR", "request commit trailers 与历史文件内容不一致", {
        request_id: requestId,
        commit: commit.sha,
        entry: {
          id: remote.entry.id,
          version: remote.entry.version,
          status: remote.entry.status,
        },
      });
    }
    return {
      ...remote,
      commitSha: commit.sha,
      requestId,
      operation,
      idempotent: true,
    };
  }

  /**
   * 枚举固定目录中的全部 Markdown 并复用 getEntry 解析为领域对象。
   *
   * 为什么存在：list/search/tag list 需要读取 GitHub 事实源，而不是读取生成 JSON 或当前工作区。
   * 数据如何流动：GET main 的递归 Git tree，筛选 content/entries 直属 .md blob 并按路径排序，再逐条调用 getEntry 校验内容与 SHA。
   * 何时失败：包括 404 在内的 API 错误、tree 被 GitHub 标记 truncated、异常目录项或任一 Markdown 损坏都会整体失败。
   * 如何排查：先 doctor，再检查 main 是否存在、Git Trees API 的 truncated 与具体失败文件；无匹配条目应由正常空 tree 表达，不能把 404 当空目录。
   * 什么不能改：不能改读 data/index.json，也不能在 adapter 内实现筛选、搜索或排序。
   */
  listEntries(): RemoteEntry[] {
    const result = this.runGh([
      "api",
      "--method",
      "GET",
      repositoryEndpoint(`/git/trees/${GITHUB_BRANCH}`),
      "-f",
      "recursive=1",
    ]);
    if (result.status !== 0) {
      throw new AppError(errorCodeFor(result), "读取 GitHub 条目目录失败", {
        stderr: result.stderr.trim(),
      });
    }
    const response = parseGitHubJson<{
      truncated?: boolean;
      tree?: Array<{ path?: string; type?: string }>;
    }>(result, "GitHub tree");
    if (response.truncated === true) {
      throw new AppError("GITHUB_ERROR", "GitHub tree 响应被截断，无法保证返回全部条目");
    }
    if (!Array.isArray(response.tree)) {
      throw new AppError("GITHUB_ERROR", "GitHub tree 响应格式异常");
    }
    return response.tree
      .filter(
        (file) =>
          file.type === "blob" &&
          /^content\/entries\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(file.path ?? ""),
      )
      .sort((left, right) => (left.path ?? "").localeCompare(right.path ?? ""))
      .map((file) => this.getEntry((file.path ?? "").split("/").at(-1)?.slice(0, -3) ?? ""));
  }

  /**
   * 解析 PUT 成功回执；回执损坏时用 request 历史确认 GitHub 是否已经提交。
   *
   * 为什么存在：网络代理可能在 GitHub 已落库后截断 stdout；这与非零超时同样属于不确定结果，不能直接报错诱导调用方换新 ID。
   * 数据如何流动：先解析 content/commit SHA；完整则返回新写结果，解析或字段失败则二次扫描 request 历史，命中时返回原 commit 的 idempotent 结果。
   * 何时失败：响应损坏且历史没有对应 request，或历史本身异常时返回 GITHUB_ERROR，不猜测成功也不再次 PUT。
   * 如何排查：用同 request ID 重试并检查 commits API；若 GitHub 无 commit，再检查原 PUT 响应与代理日志。
   * 什么不能改：不能在响应异常时生成伪 SHA、自动换 request ID 或跳过历史文件/commit 详情核验。
   */
  private finalizeWriteResponse(
    result: GhResult,
    entry: Entry,
    requestId: string,
    operation: WriteOperation,
    path: string,
  ): GitHubWriteResult {
    try {
      const response = parseGitHubJson<{
        content?: { sha?: string };
        commit?: { sha?: string };
      }>(result, `GitHub ${operation}`);
      if (!response.commit?.sha || !response.content?.sha) {
        throw new AppError("GITHUB_ERROR", "GitHub 写入响应缺少 commit 或 blob SHA", {
          id: entry.id,
          operation,
        });
      }
      return {
        entry,
        sha: response.content.sha,
        path,
        commitSha: response.commit.sha,
        requestId,
        operation,
        idempotent: false,
      };
    } catch (error) {
      const recovered = this.resolveIdempotent(requestId, entry.id, operation);
      if (recovered) return recovered;
      throw error;
    }
  }

  /**
   * 在远端 ID 不存在时用单次 PUT 创建一份 Markdown 与一个内容 commit。
   *
   * 为什么存在：create 要保证一个请求对应一个文件和一个 Git commit，并让自动/显式 ID、回收 ID 冲突与超时重试走同一路径。
   * 数据如何流动：先复验 Entry 与 Markdown 一致，再查 request 历史、通过 getEntry 判重，把内容 base64 编码后 PUT main；回执异常进入统一历史恢复。
   * 何时失败：已发布或已回收 ID 返回 ID_CONFLICT；权限、网络、异常响应或 request ID 跨操作复用返回稳定错误。
   * 如何排查：根据错误码检查远端文件与 commit trailers；不确定 PUT 是否成功时用同 request ID 原样重试。
   * 什么不能改：不能覆盖现有 SHA、不能改写本地工作区、不能创建 PR，也不能用新 request ID 重试一次不确定的写入。
   */
  createEntry(entry: Entry, markdown: string, requestId: string): GitHubWriteResult {
    if (serializeEntry(entry) !== markdown) {
      throw new AppError("VALIDATION_FAILED", "create Markdown 与领域条目不一致", {
        id: entry.id,
      });
    }
    const prior = this.resolveIdempotent(requestId, entry.id, "create");
    if (prior) return prior;
    try {
      this.getEntry(entry.id);
      throw new AppError("ID_CONFLICT", "条目 ID 已存在且不可复用", { id: entry.id });
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "NOT_FOUND") throw error;
    }

    const path = entryPath(entry.id);
    const payload = JSON.stringify({
      message: commitMessage("create", entry, requestId),
      content: Buffer.from(markdown, "utf8").toString("base64"),
      branch: GITHUB_BRANCH,
    });
    const result = this.runGh(
      ["api", "--method", "PUT", repositoryEndpoint(`/contents/${path}`), "--input", "-"],
      payload,
    );
    if (result.status !== 0) {
      const recovered = this.resolveIdempotent(requestId, entry.id, "create");
      if (recovered) return recovered;
      const code = errorCodeFor(result);
      throw new AppError(
        /(?:HTTP 409|HTTP 422|Conflict|already exists)/iu.test(result.stderr)
          ? "ID_CONFLICT"
          : code,
        "GitHub 创建条目失败",
        {
          stderr: result.stderr.trim(),
          id: entry.id,
        },
      );
    }
    return this.finalizeWriteResponse(result, entry, requestId, "create", path);
  }

  /**
   * 以版本与 blob SHA 双重 CAS 执行 update/delete/restore 的单文件 commit。
   *
   * 为什么存在：领域版本阻止旧业务状态覆盖，GitHub SHA 阻止同版本文件在远端被旁路修改；二者必须在同一写路径强制执行。
   * 数据如何流动：先校验 ID/version/SHA/request 并解析幂等历史，再读取 main 做双重比较；纯领域 mutate 生成下一版本后复验 ID/version/addedAt/status/updatedAt，序列化并带旧 SHA PUT，任何不确定回执再查 request 历史。
   * 何时失败：条目不存在、护栏冲突、mutate 校验失败、GitHub 409/422、权限或异常响应时抛出稳定错误且不自动合并。
   * 如何排查：先 get 获取最新 version/SHA；若请求可能超时，用同 request ID 原样重试；其他错误检查 commit trailers 与 API stderr。
   * 什么不能改：不能省略 SHA、自动刷新 expected 值后继续、一次写多个文件、改本地工作区或对冲突做自动重试。
   */
  mutateEntry(options: MutationOptions, mutate: (current: Entry) => Entry): GitHubWriteResult {
    if (
      !entryIdSchema.safeParse(options.id).success ||
      !Number.isInteger(options.expectedVersion) ||
      options.expectedVersion < 1 ||
      !/^[a-f0-9]{40}$/u.test(options.expectedSha)
    ) {
      throw new AppError("VALIDATION_FAILED", "mutation 并发参数不合法", {
        id: options.id,
        expected_version: options.expectedVersion,
        expected_sha: options.expectedSha,
      });
    }
    const prior = this.resolveIdempotent(options.requestId, options.id, options.operation);
    if (prior) return prior;
    const current = this.getEntry(options.id);
    if (current.entry.version !== options.expectedVersion || current.sha !== options.expectedSha) {
      throw new AppError("VERSION_CONFLICT", "条目版本或远端 SHA 已变化", {
        expected_version: options.expectedVersion,
        actual_version: current.entry.version,
        expected_sha: options.expectedSha,
        actual_sha: current.sha,
      });
    }
    const next = mutate(current.entry);
    const expectedStatus =
      options.operation === "delete"
        ? "recycled"
        : options.operation === "restore"
          ? "published"
          : current.entry.status;
    if (
      next.id !== current.entry.id ||
      next.version !== current.entry.version + 1 ||
      next.addedAt !== current.entry.addedAt ||
      next.status !== expectedStatus ||
      Date.parse(next.updatedAt) <= Date.parse(current.entry.updatedAt)
    ) {
      throw new AppError("VALIDATION_FAILED", "mutation 未生成合法的下一版本", {
        id: current.entry.id,
        current_version: current.entry.version,
        next_version: next.version,
      });
    }
    const path = entryPath(next.id);
    const result = this.runGh(
      ["api", "--method", "PUT", repositoryEndpoint(`/contents/${path}`), "--input", "-"],
      JSON.stringify({
        message: commitMessage(options.operation, next, options.requestId),
        content: Buffer.from(serializeEntry(next), "utf8").toString("base64"),
        branch: GITHUB_BRANCH,
        sha: options.expectedSha,
      }),
    );
    if (result.status !== 0) {
      const recovered = this.resolveIdempotent(options.requestId, options.id, options.operation);
      if (recovered) return recovered;
      throw new AppError(
        /(?:HTTP 409|HTTP 422|Conflict|does not match)/iu.test(result.stderr)
          ? "VERSION_CONFLICT"
          : errorCodeFor(result),
        "GitHub 修改条目失败",
        { stderr: result.stderr.trim(), id: options.id },
      );
    }
    return this.finalizeWriteResponse(result, next, options.requestId, options.operation, path);
  }
}

/**
 * 把带 GitHub SHA 的客户端视图收窄为查询层需要的 EntryReader。
 *
 * 为什么存在：纯查询模块只关心领域 Entry，不能依赖 GitHub path/SHA；内存与 GitHub adapter 因此可以交换使用。
 * 数据如何流动：get/list 委托 GitHubContentClient，再只返回 entry 字段，所有远端校验仍由客户端完成。
 * 何时失败：底层认证、网络、目录或 Markdown 错误原样抛出 AppError。
 * 如何排查：直接运行 doctor 与 entry get；wrapper 不吞错也不做缓存。
 * 什么不能改：不能在这里复制过滤/搜索逻辑，也不能丢弃底层校验后直接解析 API JSON。
 */
export class GitHubEntryReader implements EntryReader {
  constructor(private readonly client: GitHubContentClient) {}

  listEntries(): Entry[] {
    return this.client.listEntries().map((remote) => remote.entry);
  }

  getEntry(id: string): Entry {
    return this.client.getEntry(id).entry;
  }
}
