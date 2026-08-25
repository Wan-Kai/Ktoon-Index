import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseEntry, projectPublicEntry } from "../src/content/index.ts";
import detail from "../data/entries/mcp-inspector.json";
import index from "../data/index.json";
import legacy from "../content/legacy-index.json";

describe("M1 MCP Inspector 纵向读模型", () => {
  it("详情 JSON 完全由唯一 Markdown 事实源投影且不含维护字段", () => {
    const markdown = readFileSync(
      new URL("../content/entries/mcp-inspector.md", import.meta.url),
      "utf8",
    );
    const entry = parseEntry(markdown);

    expect(detail).toEqual(projectPublicEntry(entry, 1));
    expect(detail).not.toHaveProperty("version");
    expect(detail).not.toHaveProperty("status");
    expect(detail).not.toHaveProperty("sha");
    expect(detail).not.toHaveProperty("request_id");
  });

  it("首页数据保留五分类二十条，并且迁移样例只出现一次", () => {
    const entries = index.categories.flatMap((category) => category.entries);

    expect(index.categories.map((category) => category.id)).toEqual([
      "toolkit",
      "products",
      "articles",
      "standards",
      "ideas",
    ]);
    expect(entries).toHaveLength(20);
    expect(entries.filter((entry) => entry.id === "mcp-inspector")).toHaveLength(1);
    expect(
      legacy.flatMap((category) => category.entries).some((entry) => entry.id === "mcp-inspector"),
    ).toBe(false);
  });

  it("页面源文件不再保存 MCP Inspector 的结构化事实副本", () => {
    const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
    const html = readFileSync(new URL("../detail.html", import.meta.url), "utf8");

    expect(app).not.toContain('id: "mcp-inspector"');
    expect(app).not.toContain('title: "MCP Inspector"');
    expect(html).not.toContain("github.com/modelcontextprotocol/inspector");
    expect(html).not.toContain("A focused workbench for testing MCP servers");
  });
});
