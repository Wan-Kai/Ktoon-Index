import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createEntry, parseEntry, transitionEntryStatus } from "../src/content/index.ts";
import {
  buildContent,
  projectContent,
  readAuthoritativeEntries,
} from "../scripts/build-content.ts";
import { ensurePublished } from "./content-fixtures.ts";

const entryDirectory = new URL("../content/entries/", import.meta.url);
const detailDirectory = new URL("../data/entries/", import.meta.url);

function readEntries() {
  return readdirSync(entryDirectory)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => parseEntry(readFileSync(new URL(file, entryDirectory), "utf8")));
}

function readDetailFiles(): string[] {
  if (!existsSync(detailDirectory)) return [];
  return readdirSync(detailDirectory)
    .filter((file) => file.endsWith(".json"))
    .sort();
}

describe("M4 全量 Markdown 公开读模型", () => {
  it("全部条目都由唯一 Markdown 描述并服从固定分类与状态约束", () => {
    const entries = readEntries();
    const allowedCategories = new Set(["toolkit", "products", "articles", "standards", "ideas"]);

    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(entries.every((entry) => allowedCategories.has(entry.category))).toBe(true);
    expect(
      entries.every(
        (entry) => ["published", "recycled"].includes(entry.status) && entry.version >= 1,
      ),
    ).toBe(true);
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
    ).toHaveLength(projected.details.length);
    for (const category of index.categories) {
      expect(
        category.entries.every(
          (entry: { id: string; url: string }) =>
            entry.url === `./detail.html?id=${encodeURIComponent(entry.id)}`,
        ),
      ).toBe(true);
    }
  });

  it("合成 published 条目仍生成首页链接与白名单详情", () => {
    const published = createEntry(
      {
        id: "empty-optionals-fixture",
        title: "Empty optionals fixture",
        summary: "Verifies the public projection without optional fields.",
        category: "toolkit",
      },
      new Date("2098-12-31T00:00:00.000Z"),
    );
    const projected = projectContent([published]);
    const visibleEntries = projected.categories.flatMap((category) => category.entries);

    expect(visibleEntries).toEqual([
      expect.objectContaining({
        id: published.id,
        url: `./detail.html?id=${encodeURIComponent(published.id)}`,
      }),
    ]);
    expect(projected.details).toEqual([expect.objectContaining({ id: published.id })]);
    expect(projected.details[0].data).toMatchObject({
      id: published.id,
      personalTakeHtml: "",
      source: null,
      references: [],
    });
  });

  it("每个 published 条目都有白名单详情 JSON，空可选字段保持为空", () => {
    const projected = projectContent(readEntries());
    const files = readDetailFiles();

    expect(files).toHaveLength(projected.details.length);
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
  });

  it("回收条目会同时退出首页和详情投影，恢复后原位返回", () => {
    const entries = readEntries();
    const target = entries[0];
    const published = ensurePublished(target, new Date("2026-08-24T00:00:00.000Z"));
    const recycled = transitionEntryStatus(
      published,
      { expected_version: published.version, expected_sha: "b".repeat(40) },
      "recycled",
      new Date("2026-08-25T00:00:00.000Z"),
    );
    const hidden = projectContent(
      entries.map((entry) => (entry.id === target.id ? recycled : entry)),
    );

    expect(
      hidden.categories
        .flatMap((category) => category.entries)
        .some((entry) => entry.id === target.id),
    ).toBe(false);
    expect(hidden.details.some((detail) => detail.id === target.id)).toBe(false);
    const restored = transitionEntryStatus(
      recycled,
      { expected_version: recycled.version, expected_sha: "c".repeat(40) },
      "published",
      new Date("2026-08-26T00:00:00.000Z"),
    );
    const visible = projectContent(
      entries.map((entry) => (entry.id === target.id ? restored : entry)),
    );
    expect(visible.details.some((detail) => detail.id === target.id)).toBe(true);
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

  it("内容检查模式完成当前 published 投影但不改写 data", async () => {
    const entries = await readAuthoritativeEntries();
    const publishedCount = entries.filter((entry) => entry.status === "published").length;
    const paths = [
      new URL("../data/index.json", import.meta.url),
      ...readDetailFiles().map((file) => new URL(file, detailDirectory)),
    ];
    const hashes = () =>
      paths.map((path) => createHash("sha256").update(readFileSync(path)).digest("hex"));
    const before = hashes();

    await expect(readAuthoritativeEntries()).resolves.toHaveLength(entries.length);
    await expect(buildContent({ write: false })).resolves.toEqual({
      entries: publishedCount,
      details: publishedCount,
    });
    expect(hashes()).toEqual(before);
  });
});
