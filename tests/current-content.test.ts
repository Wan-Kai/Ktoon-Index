import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import categories from "./fixtures/current-content.json";

/**
 * 从尚未迁移的经典脚本中读取当前分类数据，保证 fixture 真正冻结现状而不是自我验证。
 *
 * 为什么存在：M0 仍以 `app.js` 为运行时事实源；若它变化而 fixture 不变，后续迁移测试会建立在过期基线上。
 * 数据如何流动：只截取 `const categories` 到 translations 之前的静态字面量，在无 DOM 的隔离上下文求值后返回普通数据。
 * 何时失败：标记文本被改名、分类声明加入浏览器依赖或脚本无法求值时测试直接失败，提醒维护者同步升级迁移工具。
 * 如何排查：检查 `app.js` 顶部的 categories 声明是否仍为纯数据，并比较 fixture 与运行时数据的首个差异。
 * 什么不能改：不能改成只检查条目数量或 ID；完整深比较用于防止标题、描述、评分、日期和链接静默漂移。
 */
function readLegacyCategories(): unknown {
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const translationsMarker = source.indexOf("const translations");

  if (translationsMarker === -1) {
    throw new Error("无法在 app.js 中定位 translations 标记");
  }

  const categorySource = source
    .slice(0, translationsMarker)
    .replace("const categories =", "globalThis.categories =");
  const sandbox: { categories?: unknown } = {};

  runInNewContext(categorySource, sandbox);
  return JSON.parse(JSON.stringify(sandbox.categories));
}

describe("M0 当前内容基线", () => {
  it("fixture 与当前 app.js 的完整分类数据一致", () => {
    expect(readLegacyCategories()).toEqual(categories);
  });

  it("固定五个分类并让点子位于最后", () => {
    expect(categories.map((category) => category.id)).toEqual([
      "toolkit",
      "products",
      "articles",
      "standards",
      "ideas",
    ]);
  });

  it("每个分类保留三条已评分内容和一条未评分内容", () => {
    for (const category of categories) {
      expect(category.entries).toHaveLength(4);
      expect(category.entries.filter((entry) => entry.rating !== null)).toHaveLength(3);
      expect(category.entries.filter((entry) => entry.rating === null)).toHaveLength(1);
    }
  });

  it("首页基线中的前三条依次覆盖三个评分等级", () => {
    for (const category of categories) {
      expect(category.entries.slice(0, 3).map((entry) => entry.rating)).toEqual([
        "夯",
        "人上人",
        "NPC",
      ]);
    }
  });
});
