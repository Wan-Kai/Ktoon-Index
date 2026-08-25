#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
project_root="$(CDPATH= cd -- "$skill_dir/../.." && pwd -P)"
cli="$project_root/bin/ai-index.js"

if [[ ! -x "$cli" || ! -f "$project_root/package.json" ]]; then
  printf '%s\n' '{"ok":false,"error":{"code":"BUILD_FAILED","message":"ai-index Skill 无法定位项目 CLI"}}' >&2
  exit 1
fi

cd "$project_root"
exec "$cli" "$@"
