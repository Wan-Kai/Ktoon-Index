import { describe, expect, it } from "vitest";

import { contentScaffoldStatus } from "../src/content/index.ts";

describe("M0 工程骨架", () => {
  it("明确进入首个纵向切片的准备状态", () => {
    expect(contentScaffoldStatus).toEqual({
      phase: "M0",
      readyForVerticalSlice: true,
    });
  });
});
