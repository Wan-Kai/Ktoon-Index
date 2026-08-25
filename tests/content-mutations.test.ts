import { describe, expect, it } from "vitest";

import {
  applyEntryUpdate,
  createEntry,
  parseMutationGuard,
  parseUpdateEntryRequest,
  transitionEntryStatus,
} from "../src/content/index.ts";

const sha = "a".repeat(40);

function currentEntry() {
  return createEntry(
    {
      id: "mcp-inspector",
      title: "MCP Inspector",
      summary: "Inspect MCP servers.",
      category: "toolkit",
      tags: ["MCP", "Agent Tooling"],
      rating: "夯",
      source: { title: "Source", url: "https://example.com/source" },
      references: [{ title: "Guide", url: "https://example.com/guide" }],
      personal_take: "原判断",
    },
    new Date("2026-08-25T00:00:00.000Z"),
  );
}

describe("M3 领域写入语义", () => {
  it("Merge Patch 缺失保持、null 清空、数组整体替换并只递增系统字段", () => {
    const current = currentEntry();
    const request = parseUpdateEntryRequest({
      expected_version: 1,
      expected_sha: sha,
      patch: {
        tags: ["Agent Tooling", "New Tag"],
        rating: null,
        source: null,
        references: [],
        personal_take: "  新判断  ",
      },
    });
    const next = applyEntryUpdate(current, request, new Date("2026-08-26T00:00:00.000Z"));

    expect(next).toMatchObject({
      id: current.id,
      title: current.title,
      summary: current.summary,
      tags: ["agent-tooling", "new-tag"],
      rating: null,
      source: null,
      references: [],
      personalTake: "新判断",
      version: 2,
      status: "published",
      addedAt: current.addedAt,
      updatedAt: "2026-08-26T00:00:00.000Z",
    });
  });

  it("拒绝未知字段、必填字段清空、无变化与旧版本 patch", () => {
    expect(() =>
      parseUpdateEntryRequest({
        expected_version: 1,
        expected_sha: sha,
        patch: { status: "recycled" },
      }),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() =>
      parseUpdateEntryRequest({
        expected_version: 1,
        expected_sha: sha,
        patch: { title: null },
      }),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));

    const unchanged = parseUpdateEntryRequest({
      expected_version: 1,
      expected_sha: sha,
      patch: { title: "MCP Inspector" },
    });
    expect(() => applyEntryUpdate(currentEntry(), unchanged)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    const stale = parseUpdateEntryRequest({
      expected_version: 2,
      expected_sha: sha,
      patch: { title: "Changed" },
    });
    expect(() => applyEntryUpdate(currentEntry(), stale)).toThrowError(
      expect.objectContaining({ code: "VERSION_CONFLICT" }),
    );
  });

  it("delete 与 restore 只原位切换状态并逐次递增版本", () => {
    const guard = parseMutationGuard({ expected_version: 1, expected_sha: sha });
    const recycled = transitionEntryStatus(
      currentEntry(),
      guard,
      "recycled",
      new Date("2026-08-26T00:00:00.000Z"),
    );
    const restored = transitionEntryStatus(
      recycled,
      parseMutationGuard({ expected_version: 2, expected_sha: "b".repeat(40) }),
      "published",
      new Date("2026-08-27T00:00:00.000Z"),
    );

    expect(recycled).toMatchObject({ status: "recycled", version: 2 });
    expect(restored).toMatchObject({ status: "published", version: 3 });
    expect(restored.id).toBe(recycled.id);
    expect(restored.addedAt).toBe(recycled.addedAt);
    expect(() =>
      transitionEntryStatus(restored, { ...guard, expected_version: 3 }, "published"),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("系统时钟回拨时 updatedAt 仍严格递增", () => {
    const request = parseUpdateEntryRequest({
      expected_version: 1,
      expected_sha: sha,
      patch: { summary: "Clock-safe update." },
    });
    const next = applyEntryUpdate(currentEntry(), request, new Date("2026-08-24T00:00:00.000Z"));

    expect(next.updatedAt).toBe("2026-08-25T00:00:00.001Z");
  });
});
