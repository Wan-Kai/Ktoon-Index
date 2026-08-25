import { describe, expect, it } from "vitest";

import { ERROR_CODES, AppError, type ErrorCode } from "../src/content/index.ts";

describe("M7 稳定错误码契约", () => {
  it("公开且只公开八个机器可恢复错误码", () => {
    const expected = [
      "VALIDATION_FAILED",
      "NOT_FOUND",
      "ID_CONFLICT",
      "VERSION_CONFLICT",
      "AUTH_REQUIRED",
      "FORBIDDEN",
      "GITHUB_ERROR",
      "BUILD_FAILED",
    ] satisfies ErrorCode[];

    expect(ERROR_CODES).toEqual(expected);
    for (const code of ERROR_CODES) {
      const error = new AppError(code, "probe", { code });
      expect(error).toMatchObject({ name: "AppError", code, message: "probe" });
    }
  });
});
