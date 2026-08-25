#!/usr/bin/env bash
set -euo pipefail

# 兼容任意任务 cwd 与全局符号链接安装：只以脚本真实位置回溯仓库，不能改用调用方当前目录。
skill_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
project_root="$(CDPATH= cd -- "$skill_dir/../.." && pwd -P)"
cli="$project_root/bin/ai-index.js"

# Skill 被复制出仓库或 checkout 损坏时输出单个稳定 JSON 并停止；恢复方式是修复安装链接或项目文件，不尝试其他写入路径。
if [[ ! -x "$cli" || ! -f "$project_root/package.json" ]]; then
  printf '%s\n' '{"ok":false,"error":{"code":"BUILD_FAILED","message":"ai-index Skill 无法定位项目 CLI"}}' >&2
  exit 1
fi

cd "$project_root"
exec "$cli" "$@"
