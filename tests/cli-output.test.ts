import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { parseOutputFormat, renderTable } from "../src/cli/output.ts";

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
