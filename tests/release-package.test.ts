import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { projectContent, readAuthoritativeEntries } from "../scripts/build-content.ts";
import { verifyReleasePackage } from "../scripts/check-release-package.ts";

const temporaryDirectories: string[] = [];

async function createReleaseFixture(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "ktoon-release-"));
  temporaryDirectories.push(directory);
  await mkdir(resolve(directory, "data/entries"), { recursive: true });
  const projected = projectContent(await readAuthoritativeEntries());
  await writeFile(
    resolve(directory, "index.html"),
    '<script src="./app.js"></script><link href="./..asset.css" rel="stylesheet">',
  );
  await writeFile(resolve(directory, "detail.html"), '<a href="./">Index</a>');
  await writeFile(resolve(directory, "app.js"), "void 0;\n");
  await writeFile(resolve(directory, "..asset.css"), "body{}\n");
  await writeFile(
    resolve(directory, "data/index.json"),
    JSON.stringify({ categories: projected.categories }),
  );
  for (const detail of projected.details) {
    await writeFile(
      resolve(directory, "data/entries", `${detail.id}.json`),
      JSON.stringify(detail.data),
    );
  }
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("M5 发布包校验", () => {
  it("接受从当前 Markdown 完整投影的独立静态包", async () => {
    const directory = await createReleaseFixture();

    await expect(verifyReleasePackage(directory)).resolves.toMatchObject({
      entries: 20,
      details: 20,
    });
  });

  it("聚合报告缺失静态资源和维护字段泄漏", async () => {
    const directory = await createReleaseFixture();
    await writeFile(
      resolve(directory, "index.html"),
      '<link href="./missing.css" rel="stylesheet">',
    );
    const detailPath = resolve(directory, "data/entries/mcp-inspector.json");
    const detail = JSON.parse(await readFile(detailPath, "utf8"));
    await writeFile(detailPath, JSON.stringify({ ...detail, status: "published" }));

    await expect(verifyReleasePackage(directory)).rejects.toMatchObject({
      code: "BUILD_FAILED",
      details: {
        problems: expect.arrayContaining([
          expect.stringContaining("静态引用缺失"),
          expect.stringContaining("公开数据泄漏维护字段"),
        ]),
      },
    });
  });

  it("拒绝额外公开数据、合法无引号引用、CSS import 和 symlink 逃逸", async () => {
    const directory = await createReleaseFixture();
    await mkdir(resolve(directory, "data/entries/nested"), { recursive: true });
    await mkdir(resolve(directory, "assets"), { recursive: true });
    await mkdir(resolve(directory, "assets/private"), { recursive: true });
    await writeFile(
      resolve(directory, "data/entries/nested/secret.json"),
      JSON.stringify({ request_id: "secret" }),
    );
    await writeFile(resolve(directory, "data/secret.json"), JSON.stringify({ maintainer: "me" }));
    await writeFile(
      resolve(directory, "assets/private/leak.json"),
      JSON.stringify({ request_id: "outside-data", maintainer: "me" }),
    );
    await writeFile(
      resolve(directory, "index.html"),
      '<script src=./missing-extra.js></script><link href="./style.css"><img src="./assets/escape.txt" srcset="data:image/svg+xml,%3Csvg%3E 1x, ./missing-srcset.png 2x">',
    );
    await writeFile(resolve(directory, "style.css"), '@import "./missing-import.css";');
    await symlink("/etc/hosts", resolve(directory, "assets/escape.txt"));

    await expect(verifyReleasePackage(directory)).rejects.toMatchObject({
      code: "BUILD_FAILED",
      details: {
        problems: expect.arrayContaining([
          expect.stringContaining("发布数据包含未授权文件"),
          expect.stringContaining("request_id"),
          expect.stringContaining("maintainer"),
          expect.stringContaining("assets/private/leak.json"),
          expect.stringContaining("missing-extra.js"),
          expect.stringContaining("missing-srcset.png"),
          expect.stringContaining("missing-import.css"),
          expect.stringContaining("发布包不得包含符号链接"),
          expect.stringContaining("静态引用真实路径越出发布目录"),
        ]),
      },
    });
  });
});
