import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import screenshotHashes from "./baselines/screenshots.json";
import sourceHashes from "./baselines/source-hashes.json";

/**
 * 计算基线文件的 SHA-256，阻止未经确认的页面源文件或截图漂移。
 *
 * 为什么存在：M0 的价值是冻结视觉和运行时现状；只有记录哈希而不自动核验，后续测试仍会在基线损坏时错误通过。
 * 数据如何流动：测试读取仓库文件的原始字节，计算十六进制摘要并与已确认清单逐项比较。
 * 何时失败：文件内容被修改、截图被覆盖、路径被移动或清单未同步时失败。
 * 如何排查：先确认变更是否属于已批准的视觉迭代；若是则重新真实截图并更新清单，否则恢复意外修改。
 * 什么不能改：不能对文本做换行或格式归一化，页面源码和二进制截图必须按原始字节校验。
 */
function sha256(relativePath: string): string {
  const bytes = readFileSync(new URL(relativePath, import.meta.url));
  return createHash("sha256").update(bytes).digest("hex");
}

describe("M0 页面与视觉基线", () => {
  it("五个现有页面源文件保持冻结", () => {
    for (const [file, expectedHash] of Object.entries(sourceHashes)) {
      expect(sha256(`../${file}`), file).toBe(expectedHash);
    }
  });

  it("六张响应式截图保持冻结", () => {
    for (const [file, expectedHash] of Object.entries(screenshotHashes)) {
      expect(sha256(`./baselines/${file}`), file).toBe(expectedHash);
    }
  });
});
