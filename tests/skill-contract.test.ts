import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import matter from "gray-matter";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillRoot = resolve(projectRoot, "skills/ai-index");
const runner = resolve(skillRoot, "scripts/run-ai-index.sh");

describe("M6 Agent Skill 契约", () => {
  it("提供可自动触发且无脚手架残留的 Skill 元数据", () => {
    const parsed = matter(readFileSync(resolve(skillRoot, "SKILL.md"), "utf8"));

    expect(parsed.data).toMatchObject({ name: "ai-index" });
    expect(parsed.data.description).toEqual(expect.any(String));
    expect(parsed.data.description.length).toBeGreaterThan(40);
    expect(parsed.content).not.toContain("TODO");
  });

  it("从仓库外目录稳定定位同一 CLI", () => {
    const syntax = spawnSync("bash", ["-n", runner], { encoding: "utf8" });
    const result = spawnSync(runner, ["--version"], { cwd: tmpdir(), encoding: "utf8" });

    expect(syntax.status).toBe(0);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("0.9.0");
  });

  it("通过 runner 暴露现有单条目 CRUD 命令", () => {
    const result = spawnSync(runner, ["entry", "--help"], {
      cwd: tmpdir(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    for (const command of ["create", "get", "update", "delete", "restore", "list", "search"]) {
      expect(result.stdout).toContain(command);
    }
  });

  it("为调研 Agent 提供可追踪的自动发布分支", () => {
    const skill = readFileSync(resolve(skillRoot, "SKILL.md"), "utf8");
    const workflow = readFileSync(resolve(skillRoot, "references/research-publishing.md"), "utf8");

    expect(skill).toContain("references/research-publishing.md");
    for (const invariant of [
      "Apply its research-publishing workflow",
      "Publish sequentially through the bundled CLI",
      "Omit my rating and personal judgment unless I explicitly provide them",
    ]) {
      expect(workflow).toContain(invariant);
    }
    for (const [identity, category] of [
      ["Normative protocol", "standards"],
      ["Article, tutorial", "articles"],
      ["Skill, library", "toolkit"],
      ["Standalone product", "products"],
      ["Original concept", "ideas"],
    ]) {
      expect(workflow).toContain(`| ${identity}`);
      expect(
        workflow
          .split("\n")
          .some((line) => line.startsWith(`| ${identity}`) && line.includes(`| \`${category}\` `)),
      ).toBe(true);
    }
    expect(workflow).toContain("entry get <likely-id>");
    expect(workflow).toContain("compare canonical source URLs");
    expect(workflow).toContain("Any CLI failure leaves this research-specific branch");
    expect(workflow).toContain("follows `error-recovery.md`");
    expect(workflow).toContain("duplicate that remains recycled");
    expect(workflow).toContain("not restore authorization");
  });

  it("非法 ID 通过 runner 在联网前返回稳定校验错误", () => {
    const result = spawnSync(runner, ["entry", "get", "../bad-id"], {
      cwd: tmpdir(),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
  });

  it("runner 脱离仓库时只返回稳定 BUILD_FAILED", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-index-skill-"));
    const isolatedRunner = resolve(directory, "ai-index/scripts/run-ai-index.sh");
    const scriptDirectory = resolve(isolatedRunner, "..");

    try {
      mkdirSync(scriptDirectory, { recursive: true });
      copyFileSync(runner, isolatedRunner);
      chmodSync(isolatedRunner, 0o755);
      const result = spawnSync(isolatedRunner, ["doctor"], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({
        ok: false,
        error: { code: "BUILD_FAILED" },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
