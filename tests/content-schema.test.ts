import { describe, expect, it } from "vitest";

import {
  AppError,
  createEntry,
  parseEntry,
  projectPublicEntry,
  renderRestrictedMarkdown,
  serializeEntry,
} from "../src/content/index.ts";

const createInput = {
  id: "mcp-inspector",
  title: "MCP Inspector",
  summary: "A focused workbench for testing MCP servers, tools, resources, and prompts.",
  category: "toolkit",
  tags: ["MCP", " Agent Tooling ", "ｍｃｐ"],
  rating: "夯",
  source: {
    title: "MCP Inspector",
    url: "https://github.com/modelcontextprotocol/inspector",
  },
  references: [
    {
      title: "README",
      url: "https://github.com/modelcontextprotocol/inspector#readme",
      description: "安装、启动与使用说明",
    },
  ],
  personal_take: "调试 **MCP Server** 时很实用。\n\n- 可以检查 `Tools`\n- 适合联调阶段",
};

describe("M1 Entry Schema", () => {
  it("由创建输入注入系统字段并规范化标签", () => {
    const entry = createEntry(createInput, new Date("2026-08-25T08:00:00.000Z"));

    expect(entry).toMatchObject({
      id: "mcp-inspector",
      version: 1,
      status: "published",
      addedAt: "2026-08-25T08:00:00.000Z",
      updatedAt: "2026-08-25T08:00:00.000Z",
      tags: ["mcp", "agent-tooling"],
    });
  });

  it("Frontmatter 与领域对象可以无损往返", () => {
    const entry = createEntry(
      { ...createInput, personal_take: "\n  前导与尾随会在领域入口规范化。  \n" },
      new Date("2026-08-25T08:00:00.000Z"),
    );
    const markdown = serializeEntry(entry);

    expect(markdown).toContain("id: mcp-inspector");
    expect(markdown).toContain("added_at: '2026-08-25T08:00:00.000Z'");
    expect(entry.personalTake).toBe("前导与尾随会在领域入口规范化。");
    expect(parseEntry(markdown)).toEqual(entry);
  });

  it("拒绝绕过写入入口的非规范或重复事实源标签", () => {
    const entry = createEntry(createInput, new Date("2026-08-25T08:00:00.000Z"));
    const markdown = serializeEntry(entry).replace(
      "tags:\n  - mcp\n  - agent-tooling",
      "tags:\n  - MCP\n  - ｍｃｐ",
    );

    expect(() => parseEntry(markdown)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
  });

  it("拒绝双向控制、零宽和孤立代理项等异常 Unicode 标签", () => {
    for (const tag of ["agent\u202e", "zero\u200bwidth", "broken\ud800"]) {
      expect(() => createEntry({ ...createInput, tags: [tag] })).toThrowError(
        expect.objectContaining({ code: "VALIDATION_FAILED" }),
      );
    }
  });

  it("序列化会安全引用 Frontmatter 文本，解析会拒绝未知注入字段", () => {
    const injectedTitle = "Safe title\nstatus: recycled";
    const entry = createEntry(
      { ...createInput, title: injectedTitle },
      new Date("2026-08-25T08:00:00.000Z"),
    );
    const markdown = serializeEntry(entry);

    expect(parseEntry(markdown)).toMatchObject({ title: injectedTitle, status: "published" });
    expect(() =>
      parseEntry(markdown.replace("version: 1", "version: 1\nmaintainer: attacker")),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("拒绝非 HTTPS 链接与超出白名单的 Markdown", () => {
    expect(() => createEntry({ ...createInput, category: "unknown" })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() =>
      createEntry({ ...createInput, source: { title: "bad", url: "http://example.com" } }),
    ).toThrow(AppError);
    expect(() => renderRestrictedMarkdown("# 标题")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() => renderRestrictedMarkdown("<script>alert(1)</script>")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() => renderRestrictedMarkdown("![图片](https://example.com/a.png)")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() => renderRestrictedMarkdown("[危险](javascript:alert(1))")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() =>
      renderRestrictedMarkdown("[凭据](https://user:pass@example.com/path)"),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() => parseEntry("---\nid: [broken\n---\n正文")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
  });

  it("拒绝创建条目或链接中的未知字段，避免静默丢失 Agent 意图", () => {
    expect(() => createEntry({ ...createInput, personalTake: "拼错的正文键" })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() =>
      createEntry({
        ...createInput,
        source: { ...createInput.source, description: "来源不支持描述" },
      }),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() =>
      createEntry({
        ...createInput,
        references: [{ ...createInput.references[0], note: "未知参考字段" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("公开投影不包含维护字段", () => {
    const entry = createEntry(createInput, new Date("2026-08-25T08:00:00.000Z"));
    const publicEntry = projectPublicEntry(entry);

    expect(publicEntry).not.toHaveProperty("version");
    expect(publicEntry).not.toHaveProperty("status");
    expect(publicEntry).not.toHaveProperty("requestId");
    expect(publicEntry).toMatchObject({
      id: "mcp-inspector",
      archiveCode: "AI-IX / TOOLKIT / 001",
      source: { domain: "github.com" },
    });
  });
});
