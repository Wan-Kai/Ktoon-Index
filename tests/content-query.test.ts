import { describe, expect, it } from "vitest";

import {
  MemoryEntryReader,
  createEntry,
  filterEntries,
  listTags,
  searchEntries,
  type Entry,
} from "../src/content/index.ts";

function fixture(
  id: string,
  title: string,
  summary: string,
  options: {
    category?: "toolkit" | "products";
    tags?: string[];
    rating?: "夯" | "人上人" | "NPC" | null;
    date?: string;
  } = {},
): Entry {
  return createEntry(
    {
      id,
      title,
      summary,
      category: options.category ?? "toolkit",
      tags: options.tags ?? [],
      rating: options.rating ?? null,
    },
    new Date(options.date ?? "2026-08-01T00:00:00.000Z"),
  );
}

const entries = [
  fixture("agent-workbench", "Agent Workbench", "A focused MCP debugger.", {
    tags: ["MCP", "Agent Tooling"],
    rating: "人上人",
    date: "2026-08-03T00:00:00.000Z",
  }),
  fixture("mcp", "MCP", "Exact title match.", {
    tags: ["mcp"],
    rating: "NPC",
    date: "2026-08-02T00:00:00.000Z",
  }),
  fixture("mcp-inspector", "MCP Inspector", "A debugging tool.", {
    tags: ["mcp", "debugging"],
    rating: "夯",
    date: "2026-08-01T00:00:00.000Z",
  }),
  fixture("rated-only", "Unrelated title", "No keyword here.", {
    category: "products",
    tags: ["mcp"],
    rating: "夯",
    date: "2026-08-04T00:00:00.000Z",
  }),
];

describe("M2 内容查询语义", () => {
  it("评分优先为默认排序，也支持录入时间排序", () => {
    expect(filterEntries(entries).map((entry) => entry.id)).toEqual([
      "rated-only",
      "mcp-inspector",
      "agent-workbench",
      "mcp",
    ]);
    expect(filterEntries(entries, { sort: "added_at" }).map((entry) => entry.id)).toEqual([
      "rated-only",
      "agent-workbench",
      "mcp",
      "mcp-inspector",
    ]);
  });

  it("分类、多个标签、评分和时间边界可以组合筛选", () => {
    expect(
      filterEntries(entries, {
        category: "toolkit",
        tags: ["ＭＣＰ", " debugging "],
        rating: "夯",
        addedAfter: "2026-08-01T00:00:00.000Z",
        addedBefore: "2026-08-01T00:00:00.000Z",
      }).map((entry) => entry.id),
    ).toEqual(["mcp-inspector"]);
    expect(() => filterEntries(entries, { addedAfter: "not-a-date" })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() => filterEntries(entries, { addedAfter: "August 1, 2026" })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(filterEntries(entries, { addedBefore: "2026-08-01" }).map((entry) => entry.id)).toEqual([
      "mcp-inspector",
    ]);
  });

  it("搜索只匹配标题和摘要，并按精确、标题包含、摘要包含排序", () => {
    const results = searchEntries(entries, "mcp");

    expect(results.map(({ entry, score }) => [entry.id, score])).toEqual([
      ["mcp", 300],
      ["mcp-inspector", 200],
      ["agent-workbench", 100],
    ]);
    expect(results.some(({ entry }) => entry.id === "rated-only")).toBe(false);
    expect(searchEntries(entries, "夯")).toEqual([]);
  });

  it("标签动态去重排序，内存 adapter 与直接领域数组返回相同查询结果", () => {
    const reader = new MemoryEntryReader(entries);

    expect(listTags(reader.listEntries())).toEqual(["agent-tooling", "debugging", "mcp"]);
    expect(searchEntries(reader.listEntries(), "mcp")).toEqual(searchEntries(entries, "mcp"));
    expect(reader.getEntry("mcp-inspector").version).toBe(1);
  });
});
