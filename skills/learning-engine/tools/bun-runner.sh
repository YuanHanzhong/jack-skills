#!/usr/bin/env sh
# bun-runner.sh — Hook 唯一执行入口
# 探测 Bun PATH，统一转发参数给 bun run
set +e

# 防递归（只检查 shell 层：bun-runner.sh 本身被递归调用时才阻止）
# 注意：不在此处 export LE_HOOK_ACTIVE，否则 bun 子进程会继承它，
# 导致 dispatcher.ts 内的递归守卫误触发、hook 永远不执行。
# dispatcher.ts 自己负责设置 process.env.LE_HOOK_ACTIVE 防止其子进程递归。
if [ "$LE_RUNNER_ACTIVE" = "true" ]; then
  exit 0
fi
export LE_RUNNER_ACTIVE=true


# 探测 bun 路径
if [ -n "$BUN_BIN" ] && [ -x "$BUN_BIN" ]; then
  BUN="$BUN_BIN"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
elif command -v bun >/dev/null 2>&1; then
  BUN="$(command -v bun)"
else
  # bun not found — silently skip, don't block Claude Code
  exit 0
fi

# 切换到 learning-engine 根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$LE_ROOT"

# 转发参数；hook 失败不应阻塞 Claude Code
"$BUN" run "$@" 2>&1
exit 0
