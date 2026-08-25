import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AppError } from "../content/index.ts";
import type { GitHubContentClient } from "../github/index.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * 验证当前 Node 处于项目固定的 22.x 范围。
 *
 * 为什么存在：原生 TypeScript bin、Vite 与测试都建立在 M0 固定版本上，过旧或跨 major 运行可能产生不同解析行为。
 * 数据如何流动：读取 process.versions.node，解析 major/minor/patch 并与 package engines 的 `>=22.23.1 <23` 对齐。
 * 何时失败：版本无法解析、major 不是 22，或低于 22.23.1 时返回 BUILD_FAILED。
 * 如何排查：使用 `.nvmrc` 切换 Node 后重新执行 doctor。
 * 什么不能改：不能只检查 node 命令存在，也不能在 doctor 内自动安装或切换运行时。
 */
function checkNode(): { version: string; required: string; supported: true } {
  const version = process.versions.node;
  const [major, minor, patch] = version.split(".").map(Number);
  if (!Number.isInteger(major) || major !== 22 || minor < 23 || (minor === 23 && patch < 1)) {
    throw new AppError("BUILD_FAILED", "Node 版本不满足项目要求", {
      version,
      required: ">=22.23.1 <23",
    });
  }
  return { version, required: ">=22.23.1 <23", supported: true };
}

/**
 * 以只检查模式验证本地内容构建能力且不改写 data。
 *
 * 为什么存在：doctor 要覆盖 Markdown 解析和公开投影能力，但诊断命令不能让工作区出现生成文件变化。
 * 数据如何流动：在固定项目根目录执行 `npm run build:content -- --check`，解析最后一行 JSON 并返回条目/详情计数。
 * 何时失败：npm 不可用、构建退出非零或输出契约损坏时返回 BUILD_FAILED。
 * 如何排查：直接运行同一命令查看 stderr；修复事实源或依赖后重试。
 * 什么不能改：不能回退到普通 build:content，也不能吞掉非零退出码后报告 validated=true。
 */
function checkContentBuild(): { validated: true; entries: number; details: number } {
  const result = spawnSync("npm", ["run", "build:content", "--", "--check"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new AppError("BUILD_FAILED", "内容构建能力检查失败", {
      stderr: (result.stderr ?? result.error?.message ?? "").trim(),
    });
  }
  const jsonLine = (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("{"));
  try {
    const payload = JSON.parse(jsonLine ?? "") as {
      ok?: boolean;
      check?: boolean;
      entries?: number;
      details?: number;
    };
    if (
      payload.ok !== true ||
      payload.check !== true ||
      typeof payload.entries !== "number" ||
      typeof payload.details !== "number"
    ) {
      throw new Error("unexpected payload");
    }
    return { validated: true, entries: payload.entries, details: payload.details };
  } catch {
    throw new AppError("BUILD_FAILED", "内容构建检查输出格式异常", { stdout: result.stdout });
  }
}

/**
 * 汇总 M2 CLI 运行前的本机、GitHub 与内容构建检查。
 *
 * 为什么存在：维护者需要一个命令区分运行时、认证权限和事实源构建问题，而不是等到具体查询或写入中途失败。
 * 数据如何流动：依次检查 Node、固定 GitHub 仓库和只读内容构建，全部成功后返回单个 JSON checks 对象。
 * 何时失败：任一检查失败立即抛出稳定 AppError，并且不会执行远端写操作。
 * 如何排查：根据 error.code 与失败阶段分别处理 Node、gh auth/权限或 build-content。
 * 什么不能改：不能把失败项降级为 ok=true，也不能在 doctor 中自动修复认证、依赖或内容。
 */
export function runDoctor(client: GitHubContentClient) {
  return {
    node: checkNode(),
    github: client.doctor(),
    contentBuild: checkContentBuild(),
  };
}
