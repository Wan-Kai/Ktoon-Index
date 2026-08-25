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

  it("拒绝非 HTTPS 链接与超出白名单的 Markdown", () => {
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
