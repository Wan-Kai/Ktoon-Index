import { randomUUID } from "node:crypto";

import {
  AppError,
  applyEntryUpdate,
  createEntry,
  parseUpdateEntryRequest,
  serializeEntry,
} from "../src/content/index.ts";
import {
  GITHUB_BRANCH,
  GITHUB_OWNER,
  GITHUB_REPOSITORY,
  GitHubContentClient,
  defaultGhRunner,
  type GhRunner,
} from "../src/github/index.ts";

type JsonRecord = Record<string, unknown>;

const repository = `${GITHUB_OWNER}/${GITHUB_REPOSITORY}`;
const repositoryEndpoint = `repos/${repository}`;

/**
 * 执行一次真实 gh API 调用并解析 JSON 响应。
 *
 * 为什么存在：sandbox 的分支创建、审计读取和清理不属于内容客户端公共能力，但仍需复用同一无 shell runner。参数与可选 JSON 通过 stdin 进入 gh；非零退出或损坏 JSON统一返回 GITHUB_ERROR。排查时使用 operation 与脱敏 stderr。不能拼接 shell、打印 Token 或把失败降级为继续测试。
 */
function githubJson(args: string[], operation: string, input?: JsonRecord): unknown {
  const result = defaultGhRunner(args, input === undefined ? undefined : JSON.stringify(input));
  if (result.status !== 0) {
    throw new AppError("GITHUB_ERROR", `${operation}失败`, { stderr: result.stderr.trim() });
  }
  try {
    return result.stdout.trim() ? (JSON.parse(result.stdout) as unknown) : {};
  } catch (error) {
    throw new AppError("GITHUB_ERROR", `${operation}响应不是有效 JSON`, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 把生产客户端的 main 参数定向到一次性 sandbox 分支。
 *
 * 为什么存在：M7 必须用同一 GitHubContentClient 验证真实 CAS、幂等和 trailers，又不能向 main 写测试条目。仅重写 ref=main、sha=main、tree 路径与 PUT body.branch；仓库、内容路径和其他参数保持原样。JSON 损坏时明确失败。排查时输出 sandbox 分支名。不能把可配置仓库/分支加入生产客户端或漏改历史查询，否则测试会污染 main 或得到错误幂等结论。
 */
function sandboxRunner(branch: string): GhRunner {
  return (args, input) => {
    const mappedArgs = args.map((argument) => {
      if (argument === `ref=${GITHUB_BRANCH}`) return `ref=${branch}`;
      if (argument === `sha=${GITHUB_BRANCH}`) return `sha=${branch}`;
      if (argument.endsWith(`/git/trees/${GITHUB_BRANCH}`)) {
        return argument.slice(0, -GITHUB_BRANCH.length) + branch;
      }
      return argument;
    });
    let mappedInput = input;
    if (input) {
      try {
        const payload = JSON.parse(input) as JsonRecord;
        mappedInput = JSON.stringify({
          ...payload,
          ...(payload.branch === GITHUB_BRANCH ? { branch } : {}),
        });
      } catch (error) {
        throw new AppError("VALIDATION_FAILED", "sandbox 请求 JSON 损坏", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return defaultGhRunner(mappedArgs, mappedInput);
  };
}

function requireRecord(value: unknown, operation: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("GITHUB_ERROR", `${operation}响应形状异常`);
  }
  return value as JsonRecord;
}

/**
 * 在临时远端分支验证真实权限、SHA 冲突、幂等和 commit trailers，并始终清理分支。
 *
 * 为什么存在：内存 adapter 不能证明当前 gh 身份与 GitHub Contents/Commits API 的真实语义。脚本从 main 创建唯一分支，用生产客户端 create/update/retry/stale-write，再读取 commit 证据；finally 删除远端 ref。任一步失败输出稳定错误，清理失败会保留分支名供人工删除。排查时根据返回的 branch/request/commit 定位。不能改成 main、跳过清理或用本地 Git 模拟远端 CAS。
 */
async function verifyGitHubSandbox(): Promise<JsonRecord> {
  const suffix = randomUUID().slice(0, 8);
  const branch = `m7-sandbox-${suffix}`;
  let branchCreated = false;
  let cleanupError: AppError | undefined;
  try {
    const permission = new GitHubContentClient().doctor();
    const mainRef = requireRecord(
      githubJson(
        ["api", "--method", "GET", `${repositoryEndpoint}/git/ref/heads/${GITHUB_BRANCH}`],
        "读取 main ref",
      ),
      "读取 main ref",
    );
    const object = requireRecord(mainRef.object, "读取 main ref object");
    if (typeof object.sha !== "string" || !/^[a-f0-9]{40}$/u.test(object.sha)) {
      throw new AppError("GITHUB_ERROR", "main ref 缺少合法 commit SHA");
    }
    githubJson(
      ["api", "--method", "POST", `${repositoryEndpoint}/git/refs`, "--input", "-"],
      "创建 sandbox 分支",
      { ref: `refs/heads/${branch}`, sha: object.sha },
    );
    branchCreated = true;

    const client = new GitHubContentClient(sandboxRunner(branch));
    const id = `m7-sandbox-${suffix}`;
    const createdEntry = createEntry({
      id,
      title: "M7 GitHub Sandbox",
      summary: "Disposable integration verification entry.",
      category: "standards",
      tags: ["m7-sandbox"],
      personal_take: "Temporary verification content.",
    });
    const createRequestId = randomUUID();
    const created = client.createEntry(createdEntry, serializeEntry(createdEntry), createRequestId);
    const replayed = client.createEntry(
      createdEntry,
      serializeEntry(createdEntry),
      createRequestId,
    );
    if (!replayed.idempotent || replayed.commitSha !== created.commitSha) {
      throw new AppError("GITHUB_ERROR", "create 幂等重放结果不一致", { branch, id });
    }

    const updateRequest = parseUpdateEntryRequest({
      expected_version: created.entry.version,
      expected_sha: created.sha,
      patch: { summary: "Updated once in the disposable sandbox." },
    });
    const updateRequestId = randomUUID();
    const updated = client.mutateEntry(
      {
        id,
        expectedVersion: updateRequest.expected_version,
        expectedSha: updateRequest.expected_sha,
        requestId: updateRequestId,
        operation: "update",
      },
      (current) => applyEntryUpdate(current, updateRequest),
    );
    const replayedUpdate = client.mutateEntry(
      {
        id,
        expectedVersion: updateRequest.expected_version,
        expectedSha: updateRequest.expected_sha,
        requestId: updateRequestId,
        operation: "update",
      },
      () => {
        throw new Error("幂等命中后不应再次执行 mutation");
      },
    );
    if (!replayedUpdate.idempotent || replayedUpdate.commitSha !== updated.commitSha) {
      throw new AppError("GITHUB_ERROR", "update 幂等重放结果不一致", { branch, id });
    }

    const headBeforeConflict = requireRecord(
      githubJson(
        ["api", "--method", "GET", `${repositoryEndpoint}/git/ref/heads/${branch}`],
        "读取冲突前分支 ref",
      ),
      "读取冲突前分支 ref",
    );
    let conflictVerified = false;
    try {
      client.mutateEntry(
        {
          id,
          expectedVersion: created.entry.version,
          expectedSha: created.sha,
          requestId: randomUUID(),
          operation: "update",
        },
        (current) =>
          applyEntryUpdate(current, {
            expected_version: created.entry.version,
            expected_sha: created.sha,
            patch: { title: "Stale write must fail" },
          }),
      );
    } catch (error) {
      if (error instanceof AppError && error.code === "VERSION_CONFLICT") conflictVerified = true;
      else throw error;
    }
    if (!conflictVerified) throw new AppError("GITHUB_ERROR", "旧 SHA 写入未产生 VERSION_CONFLICT");
    const headAfterConflict = requireRecord(
      githubJson(
        ["api", "--method", "GET", `${repositoryEndpoint}/git/ref/heads/${branch}`],
        "读取冲突后分支 ref",
      ),
      "读取冲突后分支 ref",
    );
    if (JSON.stringify(headBeforeConflict.object) !== JSON.stringify(headAfterConflict.object)) {
      throw new AppError("GITHUB_ERROR", "VERSION_CONFLICT 后远端分支仍发生变化", { branch });
    }

    const commit = requireRecord(
      githubJson(
        ["api", "--method", "GET", `${repositoryEndpoint}/commits/${updated.commitSha}`],
        "读取 sandbox commit",
      ),
      "读取 sandbox commit",
    );
    const commitData = requireRecord(commit.commit, "读取 sandbox commit message");
    const message = commitData.message;
    const files = commit.files;
    if (
      typeof message !== "string" ||
      !message.includes("Operation: update") ||
      !message.includes(`Entry-ID: ${id}`) ||
      !message.includes(`Content-Version: ${updated.entry.version}`) ||
      !message.includes(`Request-ID: ${updateRequestId}`) ||
      !Array.isArray(files) ||
      files.length !== 1 ||
      (files[0] as JsonRecord).filename !== `content/entries/${id}.md`
    ) {
      throw new AppError("GITHUB_ERROR", "sandbox commit trailers 或文件边界不一致", {
        branch,
        commit: updated.commitSha,
      });
    }

    return {
      ok: true,
      command: "verify:github-sandbox",
      repository,
      branch,
      permission,
      create: {
        request_id: createRequestId,
        commit_sha: created.commitSha,
        idempotent_replay: replayed.idempotent,
      },
      update: {
        request_id: updateRequestId,
        commit_sha: updated.commitSha,
        version: updated.entry.version,
        idempotent_replay: replayedUpdate.idempotent,
      },
      version_conflict: conflictVerified,
      trailers: true,
      cleanup: true,
    };
  } finally {
    if (branchCreated) {
      const result = defaultGhRunner([
        "api",
        "--method",
        "DELETE",
        `${repositoryEndpoint}/git/refs/heads/${branch}`,
      ]);
      if (result.status !== 0) {
        cleanupError = new AppError("GITHUB_ERROR", "sandbox 分支清理失败", {
          branch,
          stderr: result.stderr.trim(),
        });
      }
    }
    if (cleanupError) throw cleanupError;
  }
}

try {
  const result = await verifyGitHubSandbox();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const failure =
    error instanceof AppError
      ? error
      : new AppError("GITHUB_ERROR", "GitHub sandbox 验证失败", {
          reason: error instanceof Error ? error.message : String(error),
        });
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: { code: failure.code, message: failure.message, details: failure.details } }, null, 2)}\n`,
  );
  process.exitCode = 1;
}
