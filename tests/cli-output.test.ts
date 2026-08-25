import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

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
});
