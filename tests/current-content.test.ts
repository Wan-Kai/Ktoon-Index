import { describe, expect, it } from "vitest";

import categories from "./fixtures/current-content.json";

describe("M0 首页内容视觉基线（不参与 M4 运行时）", () => {
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
