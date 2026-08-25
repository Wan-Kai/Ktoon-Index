import { spawnSync } from "node:child_process";

import { AppError, parseEntry, type Entry } from "../content/index.ts";

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

  doctor(): { authenticated: true; repository: string; branch: string; writable: true } {
    const auth = this.runGh(["auth", "status"]);
    if (auth.status !== 0) {
      throw new AppError("AUTH_REQUIRED", "gh 尚未登录或认证已失效", {
        stderr: auth.stderr.trim(),
      });
    }

    const repo = this.runGh(["api", repositoryEndpoint(), "--jq", "{default_branch,permissions}"]);
    if (repo.status !== 0) {
      const code = /(?:HTTP 403|Forbidden)/iu.test(repo.stderr) ? "FORBIDDEN" : "GITHUB_ERROR";
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

  getEntry(id: string): RemoteEntry {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
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
      const code = /(?:HTTP 403|Forbidden)/iu.test(result.stderr) ? "FORBIDDEN" : "GITHUB_ERROR";
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
