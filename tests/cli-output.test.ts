import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { createProgram } from "../src/cli/index.ts";
import { parseOutputFormat, renderTable } from "../src/cli/output.ts";
import { GitHubContentClient, type GhRunner } from "../src/github/index.ts";

describe("M1 CLI 输出契约", () => {
  it("缺失参数时只输出机器可读 JSON", () => {
    const result = spawnSync("./bin/ai-index.js", ["entry", "get"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr) as {
      ok: boolean;
      error: { code: string; details: { commander_code: string } };
    };
    expect(error).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        details: { commander_code: "commander.missingArgument" },
      },
    });
  });

  it("table 保持完整结果并对中英文单元格做稳定换行", () => {
    const table = renderTable([
      { ID: "mcp-inspector", RATING: "夯", TITLE: "MCP Inspector" },
      { ID: "context7", RATING: "人上人", TITLE: "Context7" },
    ]);

    expect(table.split("\n")).toHaveLength(4);
    expect(table).toContain("mcp-inspector");
    expect(table).toContain("人上人");
    expect(parseOutputFormat(undefined)).toBe("json");
    expect(() => parseOutputFormat("yaml")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
  });

  it("table 会移除可能改变终端状态的控制字符", () => {
    const table = renderTable([
      {
        TITLE: "safe\u001b]8;;https://evil.example\u0007CLICK\u001b]8;;\u0007",
      },
    ]);

    expect(table).toContain("safe");
    expect(table).toContain("CLICK");
    expect(table).not.toContain("\u001b");
    expect(table).not.toContain("\u0007");
  });

  it("非法时间和空搜索词在任何 GitHub 调用前失败", async () => {
    const calls: string[][] = [];
    const runner: GhRunner = (args) => {
      calls.push(args);
      return { status: 0, stdout: "{}", stderr: "" };
    };

    await expect(
      createProgram(new GitHubContentClient(runner)).parseAsync([
        "node",
        "ai-index",
        "entry",
        "list",
        "--added-after",
        "not-a-date",
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      createProgram(new GitHubContentClient(runner)).parseAsync([
        "node",
        "ai-index",
        "entry",
        "search",
        "   ",
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls).toEqual([]);
  });

  it("未知输出格式在 GitHub 请求前返回 JSON 校验错误", () => {
    const result = spawnSync("./bin/ai-index.js", ["entry", "list", "--format", "yaml"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "format 只允许 json 或 table" },
    });
  });
});
