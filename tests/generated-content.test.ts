import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseEntry, transitionEntryStatus } from "../src/content/index.ts";
import {
  buildContent,
  projectContent,
  readAuthoritativeEntries,
} from "../scripts/build-content.ts";

const entryDirectory = new URL("../content/entries/", import.meta.url);
const detailDirectory = new URL("../data/entries/", import.meta.url);

function readEntries() {
  return readdirSync(entryDirectory)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => parseEntry(readFileSync(new URL(file, entryDirectory), "utf8")));
}

describe("M4 全量 Markdown 公开读模型", () => {
  it("二十个条目全部由唯一 Markdown 描述并覆盖固定五分类", () => {
    const entries = readEntries();

    expect(entries).toHaveLength(20);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(20);
    expect(new Set(entries.map((entry) => entry.category))).toEqual(
      new Set(["toolkit", "products", "articles", "standards", "ideas"]),
    );
    expect(entries.every((entry) => entry.status === "published" && entry.version === 1)).toBe(
      true,
    );
  });

  it("首页 JSON 完全等于 Markdown 投影，固定顺序且所有链接进入通用详情页", () => {
    const projected = projectContent(readEntries());
    const index = JSON.parse(readFileSync(new URL("../data/index.json", import.meta.url), "utf8"));

    expect(index).toEqual({ categories: projected.categories });
    expect(index.categories.map((category: { id: string }) => category.id)).toEqual([
      "toolkit",
      "products",
      "articles",
      "standards",
      "ideas",
    ]);
    expect(
      index.categories.flatMap((category: { entries: unknown[] }) => category.entries),
    ).toHaveLength(20);
    expect(
      index.categories
        .find((category: { id: string }) => category.id === "toolkit")
        ?.entries.find((entry: { id: string }) => entry.id === "mcp-inspector").tags,
    ).toEqual(["mcp", "debugging", "agent-tooling"]);
    for (const category of index.categories) {
      expect(category.entries).toHaveLength(4);
      expect(category.entries.slice(0, 3).map((entry: { rating: string }) => entry.rating)).toEqual(
        ["夯", "人上人", "NPC"],
      );
      expect(
        category.entries.every(
          (entry: { id: string; url: string }) =>
            entry.url === `./detail.html?id=${encodeURIComponent(entry.id)}`,
        ),
      ).toBe(true);
    }
  });

  it("每个 published 条目都有白名单详情 JSON，空可选字段保持为空", () => {
    const projected = projectContent(readEntries());
    const files = readdirSync(detailDirectory)
      .filter((file) => file.endsWith(".json"))
      .sort();

    expect(files).toHaveLength(20);
    expect(files).toEqual(projected.details.map((detail) => `${detail.id}.json`).sort());
    for (const detail of projected.details) {
      const generated = JSON.parse(
        readFileSync(new URL(`${detail.id}.json`, detailDirectory), "utf8"),
      );
      expect(generated).toEqual(detail.data);
      expect(generated).not.toHaveProperty("version");
      expect(generated).not.toHaveProperty("status");
      expect(generated).not.toHaveProperty("sha");
      expect(generated).not.toHaveProperty("request_id");
    }
    const article = JSON.parse(
      readFileSync(new URL("agent-receipts.json", detailDirectory), "utf8"),
    );
    expect(article).toMatchObject({ personalTakeHtml: "", source: null, references: [] });
  });

  it("回收条目会同时退出首页和详情投影，恢复后原位返回", () => {
    const entries = readEntries();
    const target = entries.find((entry) => entry.id === "context7");
    expect(target).toBeDefined();
    const recycled = transitionEntryStatus(
      target!,
      { expected_version: 1, expected_sha: "a".repeat(40) },
      "recycled",
      new Date("2026-08-25T00:00:00.000Z"),
    );
    const hidden = projectContent(
      entries.map((entry) => (entry.id === target!.id ? recycled : entry)),
    );

    expect(
      hidden.categories
        .flatMap((category) => category.entries)
        .some((entry) => entry.id === target!.id),
    ).toBe(false);
    expect(hidden.details.some((detail) => detail.id === target!.id)).toBe(false);
    const restored = transitionEntryStatus(
      recycled,
      { expected_version: 2, expected_sha: "b".repeat(40) },
      "published",
      new Date("2026-08-26T00:00:00.000Z"),
    );
    const visible = projectContent(
      entries.map((entry) => (entry.id === target!.id ? restored : entry)),
    );
    expect(visible.details.some((detail) => detail.id === target!.id)).toBe(true);
  });

  it("页面脚本不再保存任何条目结构化副本", () => {
    const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

    expect(app).toContain("let categories = [];");
    expect(app).not.toMatch(/let categories = \[\s*\{/u);
    for (const entry of readEntries()) {
      expect(app).not.toContain(`title: ${JSON.stringify(entry.title)}`);
      expect(app).not.toContain(`id: ${JSON.stringify(entry.id)}`);
    }
  });

  it("内容检查模式完成 20/20 投影但不改写 data", async () => {
    const paths = [
      new URL("../data/index.json", import.meta.url),
      ...readdirSync(detailDirectory)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => new URL(file, detailDirectory)),
    ];
    const hashes = () =>
      paths.map((path) => createHash("sha256").update(readFileSync(path)).digest("hex"));
    const before = hashes();

    await expect(readAuthoritativeEntries()).resolves.toHaveLength(20);
    await expect(buildContent({ write: false })).resolves.toEqual({ entries: 20, details: 20 });
    expect(hashes()).toEqual(before);
  });
});
