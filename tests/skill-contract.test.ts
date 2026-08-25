import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillRoot = resolve(projectRoot, "skills/ai-index");
const runner = resolve(skillRoot, "scripts/run-ai-index.sh");

describe("M6 Agent Skill 契约", () => {
  it("从仓库外目录稳定定位同一 CLI", () => {
    const syntax = spawnSync("bash", ["-n", runner], { encoding: "utf8" });
    const result = spawnSync(runner, ["--version"], { cwd: tmpdir(), encoding: "utf8" });

    expect(syntax.status).toBe(0);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("0.6.0");
  });

  it("只公开受控 runner，不提供直接事实源或 GitHub 写入备用路径", () => {
    const documents = [
      "SKILL.md",
      "references/write-contracts.md",
      "references/error-recovery.md",
    ].map((path) => readFileSync(resolve(skillRoot, path), "utf8"));
    const source = documents.join("\n");
    const skill = documents[0];

    expect(skill).toMatch(/^---\nname: ai-index\ndescription: .+\n---/u);
    expect(skill).not.toContain("TODO");
    expect(source).toContain("scripts/run-ai-index.sh");
    expect(source).toContain('"$RUNNER"');
    expect(source).toContain("VERSION_CONFLICT");
    expect(source).toContain("--request-id");
    expect(source).not.toMatch(/\bgh\s+api\b/u);
    expect(source).not.toMatch(/\bgit\s+(?:add|commit|push)\b/u);
    expect(source).not.toContain("bin/ai-index.js");
    expect(source).not.toContain("npm run ai-index");
  });

  it("固定读优先、版本护栏、幂等和无凭据边界", () => {
    const skill = readFileSync(resolve(skillRoot, "SKILL.md"), "utf8");

    expect(skill).toContain("read-first step");
    expect(skill).toContain("entry.version");
    expect(skill).toContain("same request ID");
    expect(skill).toContain("credentials out of prompts");
    expect(skill).toContain("one entry mutation at a time");
  });
});
