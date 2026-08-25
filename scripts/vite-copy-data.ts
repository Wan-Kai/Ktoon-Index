import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { Plugin } from "vite";

/**
 * 把内容构建生成的公开 JSON 放进 Vite 产物。
 *
 * 为什么存在：`data/` 位于项目根目录且不是被模块 import 的静态资产，Vite 默认不会把它复制到 dist，页面 fetch 会在生产环境 404。
 * 数据如何流动：npm prebuild 先生成 data，Vite closeBundle 再把整个目录复制到 dist/data，保持首页和详情页的相对 URL。
 * 何时失败：内容构建未执行、data 缺失或文件系统拒绝复制时生产构建失败。
 * 如何排查：先运行 `npm run build:content` 并检查 data/index.json，再检查 dist 写权限。
 * 什么不能改：不能在缺少 data 时静默跳过；发布没有内容读模型的页面等同于失败。
 */
export function copyGeneratedData(): Plugin {
  return {
    name: "copy-generated-data",
    async closeBundle() {
      const projectRoot = process.cwd();
      const target = resolve(projectRoot, "dist/data");
      await mkdir(target, { recursive: true });
      await cp(resolve(projectRoot, "data"), target, { recursive: true, force: true });
    },
  };
}
