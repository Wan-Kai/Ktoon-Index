import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { parse, type DefaultTreeAdapterMap } from "parse5";
import { describe, expect, it } from "vitest";

import { transitionEntryStatus } from "../src/content/index.ts";
import {
  buildRobots,
  buildSitemap,
  readAuthoritativeEntries,
  SITE_URL,
} from "../scripts/build-content.ts";

type HeadData = {
  links: Array<Record<string, string>>;
  metas: Array<Record<string, string>>;
};

function readHeadData(file: "index.html" | "detail.html"): HeadData {
  const result: HeadData = { links: [], metas: [] };
  const visit = (node: DefaultTreeAdapterMap["node"]): void => {
    if ("tagName" in node && "attrs" in node) {
      const attributes = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (node.tagName === "link") result.links.push(attributes);
      if (node.tagName === "meta") result.metas.push(attributes);
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")));
  return result;
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = bytes.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  throw new Error("JPEG 缺少可识别的 SOF 尺寸块");
}

describe("M9 公开站可发现性契约", () => {
  it("首页声明唯一绝对 canonical、分享摘要与 favicon", () => {
    const head = readHeadData("index.html");
    expect(head.links.filter((link) => link.rel === "canonical")).toEqual([
      { rel: "canonical", href: SITE_URL },
    ]);
    expect(head.links).toContainEqual({
      rel: "icon",
      href: "./favicon.svg",
      type: "image/svg+xml",
    });
    expect(head.metas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: "og:type", content: "website" }),
        expect.objectContaining({ property: "og:url", content: SITE_URL }),
        expect.objectContaining({
          property: "og:image",
          content: `${SITE_URL}share-image.jpg`,
        }),
        expect.objectContaining({ name: "twitter:card", content: "summary_large_image" }),
        expect.objectContaining({ name: "twitter:image", content: `${SITE_URL}share-image.jpg` }),
      ]),
    );
    const shareImage = readFileSync(new URL("../public/share-image.jpg", import.meta.url));
    expect(jpegDimensions(shareImage)).toEqual({ width: 1200, height: 630 });
    expect(createHash("sha256").update(shareImage).digest("hex")).toBe(
      "5e8ac4ea48b35785262fd49c09675e95f24880af50c89ae2fd15e209109081c7",
    );
  });

  it("动态详情源文件不预置错误 canonical，运行时只从不可变 ID 生成元信息", () => {
    const head = readHeadData("detail.html");
    const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
    expect(head.links.filter((link) => link.rel === "canonical")).toHaveLength(0);
    expect(head.links).toContainEqual({
      rel: "icon",
      href: "./favicon.svg",
      type: "image/svg+xml",
    });
    expect(app).toContain('const PRODUCTION_SITE_URL = "https://wan-kai.github.io/Ktoon-Index/";');
    expect(app).toContain("detail.html?id=${encodeURIComponent(entry.id)}");
    expect(app).not.toContain("canonicalUrl = window.location");
  });

  it("sitemap 与全部 published Markdown 一致且只包含首页和真实详情页", async () => {
    const entries = await readAuthoritativeEntries();
    const published = entries.filter((entry) => entry.status === "published");
    const generated = buildSitemap(entries);
    const committed = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
    expect(committed).toBe(generated);
    expect(generated.match(/<url>/gu)).toHaveLength(published.length + 1);
    for (const entry of published) {
      expect(generated).toContain(
        `<loc>${SITE_URL}detail.html?id=${encodeURIComponent(entry.id)}</loc>\n    <lastmod>${entry.updatedAt.slice(0, 10)}</lastmod>`,
      );
    }
    expect(generated).not.toContain("?category=");
  });

  it("空内容仍保留首页，robots 与站点根地址由同一配置生成", () => {
    expect(buildSitemap([])).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${SITE_URL}</loc>\n  </url>\n</urlset>\n`,
    );
    expect(readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8")).toBe(
      buildRobots(),
    );
  });

  it("recycled 条目退出 URL 集合且不影响首页 lastmod", async () => {
    const entries = await readAuthoritativeEntries();
    const target = entries[0];
    const recycled = transitionEntryStatus(
      target,
      { expected_version: target.version, expected_sha: "a".repeat(40) },
      "recycled",
      new Date("2099-12-31T00:00:00.000Z"),
    );
    const generated = buildSitemap(
      entries.map((entry) => (entry.id === target.id ? recycled : entry)),
    );

    expect(generated).not.toContain(`detail.html?id=${encodeURIComponent(target.id)}`);
    expect(generated).not.toContain("2099-12-31");
    expect(generated.match(/<url>/gu)).toHaveLength(entries.length);
  });
});
