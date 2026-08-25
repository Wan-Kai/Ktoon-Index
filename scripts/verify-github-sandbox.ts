import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

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
 * 把不可信的 gh stderr 收窄为固定诊断类别。
 *
 * 触发条件：任意 gh 调用失败且需要给维护者提供定位线索。处理方式：只匹配 HTTP、认证、权限、限流和网络类别，其他文本统一折叠；调用方只输出返回值。失败后的外部表现是稳定类别而非原始文本。安全不变量：绝不返回 stderr 片段，避免 Token、代理头或本机路径进入日志。
 */
export function classifyGhStderr(stderr: string): string {
  if (/HTTP 404|not found/iu.test(stderr)) return "not_found";
  if (/HTTP 401|auth|login|token/iu.test(stderr)) return "authentication_failed";
  if (/HTTP 403|forbidden|permission/iu.test(stderr)) return "permission_denied";
  if (/rate.?limit/iu.test(stderr)) return "rate_limited";
  if (/timeout|timed out|network|connection/iu.test(stderr)) return "network_failed";
  return "gh_command_failed";
}

/**
 * 为脚本最终错误输出建立字段白名单并递归清理 cleanup 诊断。
 *
 * 触发条件：AppError 即将序列化到 stderr。处理方式：stderr 只保留分类，内部 reason 被固定占位，其他字段仅允许脚本生成的标识、版本和 SHA。未知形状返回空详情；维护者仍可用 branch/commit/exit status 排查。安全不变量：不得为调试方便恢复原始 stderr 或任意远端字符串。
 */
export function sanitizeFailureDetails(details: unknown): JsonRecord | undefined {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return undefined;
  const source = details as JsonRecord;
  const safe: JsonRecord = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "stderr" && typeof value === "string") {
      safe.diagnostic = classifyGhStderr(value);
      continue;
    }
    if (key === "reason") {
      safe.reason = "internal_error_omitted";
      continue;
    }
    if (key === "cleanup_error") {
      safe.cleanup_error = sanitizeFailureDetails(value);
      continue;
    }
    if (
      [
        "branch",
        "id",
        "operation",
        "commit",
        "expected_version",
        "actual_version",
        "expected_sha",
        "actual_sha",
        "exit_status",
        "diagnostic",
      ].includes(key) &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    ) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

/**
 * 在验证失败与清理失败同时发生时保留主失败语义。
 *
 * 触发条件：sandbox 主流程已有异常，且删除一次性分支也失败。处理方式：沿用主错误码和消息，把脱敏后的清理错误附加到 details；未知主异常统一映射为 GITHUB_ERROR。外部会先看到真正导致验证失败的原因，同时拿到待清理分支线索。错误优先级与 cleanup_error 字段是恢复不变量，不能让 finally 覆盖主错误。
 */
export function attachCleanupError(primaryError: unknown, cleanupError: AppError): AppError {
  const failure =
    primaryError instanceof AppError
      ? primaryError
      : new AppError("GITHUB_ERROR", "GitHub sandbox 验证失败");
  return new AppError(failure.code, failure.message, {
    ...sanitizeFailureDetails(failure.details),
    cleanup_error: sanitizeFailureDetails(cleanupError.details),
  });
}

/**
 * 执行一次真实 gh API 调用并解析 JSON 响应。
 *
 * 为什么存在：sandbox 的分支创建、审计读取和清理不属于内容客户端公共能力，但仍需复用同一无 shell runner。参数与可选 JSON 通过 stdin 进入 gh；非零退出或损坏 JSON 统一返回 GITHUB_ERROR。排查时只保留 operation、退出码和白名单化诊断类别。不能拼接 shell、打印 Token 或把失败降级为继续测试。
 */
function githubJson(args: string[], operation: string, input?: JsonRecord): unknown {
  const result = defaultGhRunner(args, input === undefined ? undefined : JSON.stringify(input));
  if (result.status !== 0) {
    throw new AppError("GITHUB_ERROR", `${operation}失败`, {
      diagnostic: classifyGhStderr(result.stderr),
      exit_status: result.status,
    });
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
 * 为什么存在：M7 必须用同一 GitHubContentClient 验证真实 CAS、幂等和 trailers，又不能向 main 写测试条目。重写已知 main 引用后逐类检查 Contents、commit history 与 mutation 的分支约束；未知写法直接失败。历史 commit SHA 可用于幂等读取，但任何默认分支读取或非 Contents 写入均被拒绝。排查时只输出 sandbox 分支名。不能把可配置仓库/分支加入生产客户端或放宽为默认分支，否则测试会污染 main。
 */
export function sandboxRunner(branch: string, runGh: GhRunner = defaultGhRunner): GhRunner {
  return (args, input) => {
    const methodIndex = args.indexOf("--method");
    const method = methodIndex >= 0 ? args[methodIndex + 1] : undefined;
    const endpoint = args.find((argument) => argument.startsWith(`${repositoryEndpoint}/`));
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
        if ("branch" in payload && payload.branch !== GITHUB_BRANCH) {
          throw new AppError("VALIDATION_FAILED", "sandbox 请求包含非 main 的意外分支", {
            branch,
          });
        }
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

    const mappedPayload = mappedInput ? (JSON.parse(mappedInput) as JsonRecord) : undefined;
    const isContentRequest = endpoint?.includes("/contents/") === true;
    if (method === "PUT") {
      if (!isContentRequest || mappedPayload?.branch !== branch) {
        throw new AppError("VALIDATION_FAILED", "sandbox 拒绝未明确指向临时分支的写请求", {
          branch,
        });
      }
    } else if (["POST", "PATCH", "DELETE"].includes(method ?? "")) {
      throw new AppError("VALIDATION_FAILED", "sandbox 拒绝内容客户端的意外写请求", {
        branch,
      });
    }
    if (
      isContentRequest &&
      method === "GET" &&
      !mappedArgs.some(
        (argument) => argument === `ref=${branch}` || /^ref=[a-f0-9]{40}$/u.test(argument),
      )
    ) {
      throw new AppError("VALIDATION_FAILED", "sandbox 内容读取缺少临时分支或历史 commit ref", {
        branch,
      });
    }
    if (endpoint?.endsWith("/commits") && !mappedArgs.includes(`sha=${branch}`)) {
      throw new AppError("VALIDATION_FAILED", "sandbox 历史读取缺少临时分支 sha", { branch });
    }
    if (
      mappedArgs.includes(`ref=${GITHUB_BRANCH}`) ||
      mappedArgs.includes(`sha=${GITHUB_BRANCH}`) ||
      mappedArgs.some((argument) => argument.endsWith(`/git/trees/${GITHUB_BRANCH}`))
    ) {
      throw new AppError("VALIDATION_FAILED", "sandbox 请求仍残留生产分支引用", { branch });
    }
    return runGh(mappedArgs, mappedInput);
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
 * 为什么存在：内存 adapter 不能证明当前 gh 身份与 GitHub Contents/Commits API 的真实语义。脚本从 main 创建唯一分支，用生产客户端 create/update/retry/stale-write，再读取 commit 证据；创建请求发出后无论响应是否确定都探测删除远端 ref。任一步失败输出稳定且脱敏的错误；验证与清理同时失败时保留主错误并附加分支清理诊断。不能改成 main、跳过清理或用本地 Git 模拟远端 CAS。
 */
async function verifyGitHubSandbox(): Promise<JsonRecord> {
  const suffix = randomUUID().slice(0, 8);
  const branch = `m7-sandbox-${suffix}`;
  let branchCreationAttempted = false;
  let cleanupError: AppError | undefined;
  let primaryError: unknown;
  let outcome: JsonRecord | undefined;
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
    branchCreationAttempted = true;
    githubJson(
      ["api", "--method", "POST", `${repositoryEndpoint}/git/refs`, "--input", "-"],
      "创建 sandbox 分支",
      { ref: `refs/heads/${branch}`, sha: object.sha },
    );
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

    outcome = {
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
  } catch (error) {
    primaryError = error;
  }

  if (branchCreationAttempted) {
    const result = defaultGhRunner([
      "api",
      "--method",
      "DELETE",
      `${repositoryEndpoint}/git/refs/heads/${branch}`,
    ]);
    if (result.status !== 0 && !/HTTP 404|not found/iu.test(result.stderr)) {
      cleanupError = new AppError("GITHUB_ERROR", "sandbox 分支清理失败", {
        branch,
        diagnostic: classifyGhStderr(result.stderr),
        exit_status: result.status,
      });
    }
  }

  if (primaryError) {
    if (cleanupError) {
      throw attachCleanupError(primaryError, cleanupError);
    }
    throw primaryError;
  }
  if (cleanupError) throw cleanupError;
  if (!outcome) throw new AppError("GITHUB_ERROR", "GitHub sandbox 未产生验证结果");
  return outcome;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
      `${JSON.stringify({ ok: false, error: { code: failure.code, message: failure.message, details: sanitizeFailureDetails(failure.details) } }, null, 2)}\n`,
    );
    process.exitCode = 1;
  }
}
