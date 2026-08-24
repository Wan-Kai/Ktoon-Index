import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { Plugin } from "vite";

/**
 * 在 Vue 接管页面入口之前保留现有经典脚本。
 *
 * 为什么存在：当前首页和详情页仍通过非 module 的 `app.js` 运行，Vite 会保留 HTML 引用但不会自动复制该文件，直接发布会得到缺少脚本的 dist。
 * 数据如何流动：构建完成后从项目根目录读取 `app.js`，原样复制到 dist 根目录，让带缓存参数的既有引用继续有效。
 * 何时失败：源文件缺失、dist 无法创建或文件系统拒绝写入时，Vite 构建会直接失败，禁止产生看似成功但不可交互的站点。
 * 如何排查：先检查项目根目录是否存在 `app.js`，再检查 dist 权限，并确认 Vite 的 `outDir` 仍为默认 `dist`。
 * 什么不能改：在 M4 完成页面数据化前不能移除此插件，也不能把失败吞掉；否则构建产物会静默丢失全部现有交互。
 */
export function preserveLegacyStaticScript(): Plugin {
  return {
    name: "preserve-legacy-static-script",
    async closeBundle() {
      const projectRoot = process.cwd();
      const outputDirectory = resolve(projectRoot, "dist");

      await mkdir(outputDirectory, { recursive: true });
      await copyFile(resolve(projectRoot, "app.js"), resolve(outputDirectory, "app.js"));
    },
  };
}
