import { describe, expect, it, vi } from "vitest";

import {
  attachCleanupError,
  attemptSandboxBranchCreation,
  classifyGhStderr,
  cleanupSandboxBranch,
  sandboxRunner,
  sanitizeFailureDetails,
} from "../scripts/verify-github-sandbox.ts";
import type { GhRunner } from "../src/github/index.ts";

describe("M7 GitHub sandbox 安全边界", () => {
  it("错误输出只保留诊断类别，不泄露 token-like stderr", () => {
    const secret = "ghp_super_secret_value";
    const details = sanitizeFailureDetails({
      branch: "m7-sandbox-deadbeef",
      stderr: `HTTP 401 token ${secret}`,
      reason: secret,
    });

    expect(classifyGhStderr(`token ${secret}`)).toBe("authentication_failed");
    expect(details).toEqual({
      branch: "m7-sandbox-deadbeef",
      diagnostic: "authentication_failed",
      reason: "internal_error_omitted",
    });
    expect(JSON.stringify(details)).not.toContain(secret);
  });

  it("把已知 main 读写严格改写到 sandbox", () => {
    const calls: Array<{ args: string[]; input?: string }> = [];
    const base: GhRunner = vi.fn((args, input) => {
      calls.push({ args, input });
      return { status: 0, stdout: "{}", stderr: "" };
    });
    const run = sandboxRunner("m7-sandbox-deadbeef", base);

    run(
      [
        "api",
        "--method",
        "PUT",
        "repos/Wan-Kai/Ktoon-Index/contents/content/entries/example.md",
        "--input",
        "-",
      ],
      JSON.stringify({ branch: "main", content: "ZGF0YQ==" }),
    );

    expect(JSON.parse(calls[0]?.input ?? "{}")).toMatchObject({
      branch: "m7-sandbox-deadbeef",
    });
  });

  it("拒绝省略分支的 Contents 读写和未知 mutation", () => {
    const base: GhRunner = vi.fn(() => ({ status: 0, stdout: "{}", stderr: "" }));
    const run = sandboxRunner("m7-sandbox-deadbeef", base);
    const contentEndpoint = "repos/Wan-Kai/Ktoon-Index/contents/content/entries/example.md";

    expect(() =>
      run(["api", "--method", "PUT", contentEndpoint, "--input", "-"], "{}"),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => run(["api", "--method", "GET", contentEndpoint])).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() =>
      run(["api", "--method", "DELETE", "repos/Wan-Kai/Ktoon-Index/git/refs/heads/main"]),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => run(["api", contentEndpoint, "--input", "-"], "{}")).toThrowError(
      expect.objectContaining({ message: "sandbox 拒绝未列入白名单的 gh 请求形状" }),
    );
    expect(() =>
      run(
        ["api", "--method", "PUT", contentEndpoint, "--input", "-"],
        JSON.stringify({ branch: "feature" }),
      ),
    ).toThrowError(expect.objectContaining({ message: "sandbox 请求包含非 main 的意外分支" }));
    expect(base).not.toHaveBeenCalled();
  });

  it("区分确认创建、明确冲突和结果不确定，并只清理拥有或不确定的 ref", () => {
    const sha = "a".repeat(40);
    const notFound = { status: 1, stdout: "", stderr: "HTTP 404: Not Found" };
    const successRunner: GhRunner = vi
      .fn()
      .mockReturnValueOnce(notFound)
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({ ref: "refs/heads/m7-sandbox-owned" }),
        stderr: "",
      });
    expect(attemptSandboxBranchCreation("m7-sandbox-owned", sha, successRunner)).toEqual({
      ownership: "owned",
    });

    const conflictRunner: GhRunner = vi
      .fn()
      .mockReturnValueOnce(notFound)
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "HTTP 422: Reference already exists" });
    const conflict = attemptSandboxBranchCreation("m7-sandbox-conflict", sha, conflictRunner);
    expect(conflict).toMatchObject({ ownership: "none", error: { code: "GITHUB_ERROR" } });
    const forbiddenDelete: GhRunner = vi.fn(() => {
      throw new Error("none 所有权不应删除分支");
    });
    expect(
      cleanupSandboxBranch("m7-sandbox-conflict", conflict.ownership, forbiddenDelete),
    ).toBeUndefined();
    expect(forbiddenDelete).not.toHaveBeenCalled();

    const uncertainRunner: GhRunner = vi
      .fn()
      .mockReturnValueOnce(notFound)
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "network timeout" });
    const uncertain = attemptSandboxBranchCreation("m7-sandbox-uncertain", sha, uncertainRunner);
    expect(uncertain).toMatchObject({ ownership: "uncertain", error: { code: "GITHUB_ERROR" } });
    const cleanup404: GhRunner = vi.fn(() => notFound);
    expect(
      cleanupSandboxBranch("m7-sandbox-uncertain", uncertain.ownership, cleanup404),
    ).toBeUndefined();
    expect(cleanup404).toHaveBeenCalledOnce();
  });

  it("清理失败不会覆盖原始验证错误", async () => {
    const { AppError } = await import("../src/content/index.ts");
    const primary = new AppError("VERSION_CONFLICT", "原始冲突", {
      id: "example",
      stderr: "ghp_primary_secret",
    });
    const cleanup = new AppError("GITHUB_ERROR", "清理失败", {
      branch: "m7-sandbox-deadbeef",
      stderr: "ghp_cleanup_secret",
    });

    const combined = attachCleanupError(primary, cleanup);

    expect(combined).toMatchObject({ code: "VERSION_CONFLICT", message: "原始冲突" });
    expect(combined.details).toEqual({
      id: "example",
      diagnostic: "gh_command_failed",
      cleanup_error: {
        branch: "m7-sandbox-deadbeef",
        diagnostic: "gh_command_failed",
      },
    });
    expect(JSON.stringify(combined.details)).not.toContain("secret");
  });
});
