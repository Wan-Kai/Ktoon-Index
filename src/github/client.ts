import { spawnSync } from "node:child_process";

import {
  AppError,
  entryIdSchema,
  parseEntry,
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
 * 固定项目的 GitHub 内容客户端。
 *
 * 为什么存在：内容模块不应知道 GitHub 命令细节；未来 MCP 或测试 adapter 可以复用领域层而不复制校验。
 * 数据如何流动：客户端只读取或 PUT 单个 `content/entries/<id>.md`，目标始终是固定仓库 main，不接触当前工作区。
 * 何时失败：认证、权限、网络、ID 冲突或 GitHub API 错误会变成稳定 AppError。
 * 如何排查：先执行 doctor；若是 GITHUB_ERROR，再用 GitHub Actions/CLI 日志中的 request 信息定位。
 * 什么不能改：M1 不能接受任意 owner/repo/branch 参数，不能创建 PR，也不能自动合并或重试冲突。
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
    const data = JSON.parse(repo.stdout) as {
      default_branch?: string;
      permissions?: { push?: boolean };
    };
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
      `ref=${GITHUB_BRANCH}`,
    ]);
    if (isNotFound(result)) throw new AppError("NOT_FOUND", "条目不存在", { id });
    if (result.status !== 0) {
      throw new AppError("GITHUB_ERROR", "读取 GitHub 条目失败", { stderr: result.stderr.trim() });
    }

    const response = JSON.parse(result.stdout) as {
      content: string;
      encoding: string;
      sha: string;
    };
    if (response.encoding !== "base64" || !response.sha) {
      throw new AppError("GITHUB_ERROR", "GitHub 内容响应格式异常", { id });
    }
    const source = Buffer.from(response.content.replace(/\n/gu, ""), "base64").toString("utf8");
    return { entry: parseEntry(source), sha: response.sha, path };
  }

  /**
   * 枚举固定目录中的全部 Markdown 并复用 getEntry 解析为领域对象。
   *
   * 为什么存在：list/search/tag list 需要读取 GitHub 事实源，而不是读取生成 JSON 或当前工作区。
   * 数据如何流动：GET main 的递归 Git tree，筛选 content/entries 直属 .md blob 并按路径排序，再逐条调用 getEntry 校验内容与 SHA。
   * 何时失败：API 错误、tree 被 GitHub 标记 truncated、异常目录项或任一 Markdown 损坏会整体失败。
   * 如何排查：先 doctor，再检查 Git Trees API 的 truncated 与具体失败文件；不能跳过坏文件返回不完整列表。
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
    if (isNotFound(result)) return [];
    if (result.status !== 0) {
      throw new AppError(errorCodeFor(result), "读取 GitHub 条目目录失败", {
        stderr: result.stderr.trim(),
      });
    }
    const response = JSON.parse(result.stdout) as {
      truncated?: boolean;
      tree?: Array<{ path?: string; type?: string }>;
    };
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
   * 在远端 ID 不存在时用单次 PUT 创建一份 Markdown 与一个内容 commit。
   *
   * 为什么存在：M1 要保证一个写操作对应一个文件和一个 Git commit，并把版本与 request ID 留在可审计 trailer 中。
   * 数据如何流动：先通过 getEntry 判重，再把已校验 Markdown base64 编码，PUT 到固定 main，最后只返回 commit SHA 与路径。
   * 何时失败：已有 ID 返回 ID_CONFLICT；权限、网络或异常 API 响应返回 FORBIDDEN/GITHUB_ERROR，绝不自动重试。
   * 如何排查：根据错误码检查远端文件、doctor 与 GitHub API 响应；请求失败后先 get 确认是否已落盘。
   * 什么不能改：不能覆盖现有 SHA、不能改写本地工作区、不能创建 PR，也不能在 M3 幂等机制完成前自动重试。
   */
  createEntry(
    entry: Entry,
    markdown: string,
    requestId: string,
  ): { commitSha: string; path: string } {
    try {
      this.getEntry(entry.id);
      throw new AppError("ID_CONFLICT", "条目 ID 已存在且不可复用", { id: entry.id });
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "NOT_FOUND") throw error;
    }

    const path = entryPath(entry.id);
    const message = [
      `content: create ${entry.id}`,
      "",
      "Operation: create",
      `Entry-ID: ${entry.id}`,
      `Content-Version: ${entry.version}`,
      `Request-ID: ${requestId}`,
    ].join("\n");
    const payload = JSON.stringify({
      message,
      content: Buffer.from(markdown, "utf8").toString("base64"),
      branch: GITHUB_BRANCH,
    });
    const result = this.runGh(
      ["api", "--method", "PUT", repositoryEndpoint(`/contents/${path}`), "--input", "-"],
      payload,
    );
    if (result.status !== 0) {
      const code = errorCodeFor(result);
      throw new AppError(code, "GitHub 创建条目失败", {
        stderr: result.stderr.trim(),
        id: entry.id,
      });
    }
    const response = JSON.parse(result.stdout) as { commit?: { sha?: string } };
    if (!response.commit?.sha) {
      throw new AppError("GITHUB_ERROR", "GitHub 创建响应缺少 commit SHA", { id: entry.id });
    }
    return { commitSha: response.commit.sha, path };
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
