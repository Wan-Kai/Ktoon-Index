import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { parse, type DefaultTreeAdapterMap } from "parse5";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const paperPreload = "./assets/paper-grain.webp";

function preloadImages(source: string): string[] {
  const images: string[] = [];
  const visit = (node: DefaultTreeAdapterMap["node"]): void => {
    if ("tagName" in node && node.tagName === "link" && "attrs" in node) {
      const attributes = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (
        attributes.rel?.split(/\s+/u).includes("preload") &&
        attributes.as === "image" &&
        attributes.type === "image/webp" &&
        attributes.href
      ) {
        images.push(attributes.href);
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(source));
  return images;
}

function webpDimensions(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === "VP8 ") {
      expect(bytes.subarray(data + 3, data + 6).toString("hex")).toBe("9d012a");
      return {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff,
      };
    }
    offset = data + size + (size % 2);
  }
  throw new Error("WebP 缺少可识别的 VP8 尺寸块");
}

describe("首页与详情页性能契约", () => {
  it("纸张纹理进入首屏预加载且不保留采样探针", async () => {
    const pages = await Promise.all(
      ["index.html", "detail.html"].map((file) => readFile(resolve(projectRoot, file), "utf8")),
    );

    for (const page of pages) {
      expect(preloadImages(page)).toContain(paperPreload);
      expect(page).not.toContain("perf_probe");
    }
  });

  it("高频纹理保持在已确认的体积、尺寸和内容基线内", async () => {
    const fixtures = [
      {
        file: "graphite-grain.webp",
        maxBytes: 130_000,
        sha256: "9a53aa725f7b16f34a1e450295680e9d1466417f82681196439b652993b549f9",
      },
      {
        file: "paper-grain.webp",
        maxBytes: 70_000,
        sha256: "a997d48a8043393b217eb7b45fcfba608607b75a128a0c1504efe02738547e33",
      },
    ];

    for (const fixture of fixtures) {
      const path = resolve(projectRoot, "assets", fixture.file);
      const [metadata, bytes] = await Promise.all([stat(path), readFile(path)]);
      expect(metadata.size).toBeLessThanOrEqual(fixture.maxBytes);
      expect(webpDimensions(bytes)).toEqual({ width: 1600, height: 1600 });
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
    }
  });

  it("生产构建让 preload 与 CSS 复用同一份带哈希纸张纹理", async () => {
    await build({ logLevel: "silent" });
    const output = resolve(projectRoot, "dist");
    const pages = await Promise.all(
      ["index.html", "detail.html"].map((file) => readFile(resolve(output, file), "utf8")),
    );
    const cssFiles = (await readdir(resolve(output, "assets"))).filter((file) =>
      file.endsWith(".css"),
    );
    const css = (
      await Promise.all(cssFiles.map((file) => readFile(resolve(output, "assets", file), "utf8")))
    ).join("\n");
    const cssPaperAssets = new Set(css.match(/paper-grain-[a-zA-Z0-9_-]+\.webp/gu) ?? []);

    expect(cssPaperAssets.size).toBe(1);
    const [cssPaperAsset] = cssPaperAssets;
    for (const page of pages) {
      const builtPreloads = preloadImages(page).map((asset) => basename(asset));
      expect(builtPreloads.filter((asset) => asset === cssPaperAsset)).toHaveLength(1);
    }
  });
});
