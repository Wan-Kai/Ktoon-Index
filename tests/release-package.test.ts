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
    '<!-- <base href="./ignored/"> --><script src="./app.js"></script><link href="./..asset.css" rel="stylesheet">',
  );
  await writeFile(resolve(directory, "detail.html"), '<a href="./">Index</a>');
  await writeFile(resolve(directory, "app.js"), "void 0;\n");
  await writeFile(resolve(directory, "..asset.css"), "body{}\n");
  await writeFile(resolve(directory, "imported.css"), "body{}\n");
  await writeFile(
    resolve(directory, "conditional.css"),
    '@import url("./imported.css") screen;@importurl("./ignored.css");@import\u00a0"./ignored-nbsp.css";@im\\\nport "./ignored-newline.css";\n',
  );
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
    await mkdir(resolve(directory, "%2e%2e"), { recursive: true });
    await mkdir(resolve(directory, "&#x2e;&#x2e;"), { recursive: true });
    await mkdir(resolve(directory, "&period;&period;"), { recursive: true });
    await mkdir(resolve(directory, "sub"), { recursive: true });
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
      resolve(directory, "assets/private/upper.JSON"),
      JSON.stringify({ request_id: "uppercase", maintainer: "me" }),
    );
    await writeFile(resolve(directory, "%2e%2e/outside.js"), "void 0;\n");
    await writeFile(resolve(directory, "&#x2e;&#x2e;/outside.js"), "void 0;\n");
    await writeFile(resolve(directory, "&period;&period;/outside.js"), "void 0;\n");
    await writeFile(resolve(directory, "base-target.js"), "void 0;\n");
    await writeFile(resolve(directory, "srcset-nbsp"), "decoy\n");
    await writeFile(resolve(directory, "css-nbsp"), "decoy\n");
    const escapedCssDecoy = resolve(directory, "safe", "\\2e\\2e ", "\\2e\\2e ", "outside.png");
    await mkdir(resolve(escapedCssDecoy, ".."), { recursive: true });
    await writeFile(escapedCssDecoy, "decoy\n");
    await writeFile(
      resolve(directory, "index.html"),
      '<base href="./sub/"><script src=./missing-extra.js></script><script src="https:/missing-root.js"></script><script src="./%2e%2e/outside.js"></script><script src="./&#x2e&#x2e/outside.js"></script><script src="./&period;&period;/outside.js"></script><script src="./base-target.js"></script><link href="./style.css" imagesrcset="./missing-link-srcset.png 1x"><img src="./assets/escape.txt" srcset="data:image/svg+xml,%3Csvg%3E 1x, ./missing-srcset.png 2x"><img srcset="./srcset-nbsp\u00a0file.png 1x"><div style="background:url(./missing-inline.png)"></div><style>.x{background:url(./missing-style-block.png)}</style>',
    );
    await writeFile(
      resolve(directory, "style.css"),
      '@import "./missing-import.css";@import "./missing-supported-import.css" supports(background-image: url("./import-condition-decoy.png"));@im\\70 ort "./missing-escaped-import.css";@im\\70 ort/**/"./missing-comment-import.css";.x{background:url(./safe/\\2e\\2e /\\2e\\2e /outside.png)}.y{background:u\\72l("./missing-escaped-function.png")}.z{background-image:image-set("./missing-1x.png" 1x)}.n{background:url(./css-nbsp\u00a0)}',
    );
    await writeFile(resolve(directory, "import-condition-decoy.png"), "decoy\n");
    await symlink("/etc/hosts", resolve(directory, "assets/escape.txt"));

    await expect(verifyReleasePackage(directory)).rejects.toMatchObject({
      code: "BUILD_FAILED",
      details: {
        problems: expect.arrayContaining([
          expect.stringContaining("发布数据包含未授权文件"),
          expect.stringContaining("request_id"),
          expect.stringContaining("maintainer"),
          expect.stringContaining("assets/private/leak.json"),
          expect.stringContaining("assets/private/upper.JSON"),
          expect.stringContaining("missing-extra.js"),
          expect.stringContaining("missing-srcset.png"),
          expect.stringContaining("missing-link-srcset.png"),
          expect.stringContaining("missing-inline.png"),
          expect.stringContaining("missing-style-block.png"),
          expect.stringContaining("missing-escaped-function.png"),
          expect.stringContaining("missing-1x.png"),
          expect.stringContaining("URL 解析后越出发布目录"),
          expect.stringContaining("safe/../../outside.png"),
          expect.stringContaining("https:/missing-root.js"),
          expect.stringContaining("./../outside.js"),
          expect.stringContaining("不允许 base 元素"),
          expect.stringContaining("missing-import.css"),
          expect.stringContaining("missing-supported-import.css"),
          expect.stringContaining("missing-escaped-import.css"),
          expect.stringContaining("missing-comment-import.css"),
          expect.stringContaining("srcset-nbsp\u00a0file.png"),
          expect.stringContaining("css-nbsp\u00a0"),
          expect.stringContaining("发布包不得包含符号链接"),
          expect.stringContaining("静态引用真实路径越出发布目录"),
        ]),
      },
    });
  });
});
