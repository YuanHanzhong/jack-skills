#!/bin/sh
# 跨平台 bun 启动器 - 解决 hooks 中 bun 不在 PATH 的问题
# 用法: sh tools/bun-runner.sh <bun的原始参数...>
# 优化：第一次发现bun路径后缓存到 ~/.claude/bun-path.cache，后续直接使用

CACHE_FILE="$HOME/.claude/bun-path.cache"

# 优先使用缓存路径
if [ -f "$CACHE_FILE" ]; then
  BUN_PATH=$(cat "$CACHE_FILE" 2>/dev/null)
  if [ -n "$BUN_PATH" ] && [ -x "$BUN_PATH" ]; then
    exec "$BUN_PATH" "$@"
  fi
fi

# 尝试在 PATH 中找 bun
if command -v bun >/dev/null 2>&1; then
  BUN_PATH=$(command -v bun)
  mkdir -p "$(dirname "$CACHE_FILE")" 2>/dev/null
  echo "$BUN_PATH" > "$CACHE_FILE" 2>/dev/null
  exec "$BUN_PATH" "$@"
fi

# 按常见安装位置查找
for candidate in \
  "$HOME/.bun/bin/bun" \
  "/usr/local/bin/bun" \
  "/opt/homebrew/bin/bun"; do
  if [ -x "$candidate" ]; then
    mkdir -p "$(dirname "$CACHE_FILE")" 2>/dev/null
    echo "$candidate" > "$CACHE_FILE" 2>/dev/null
    exec "$candidate" "$@"
  fi
done

# 兜底：报出有意义的错误
echo "bun-runner: bun not found. Searched PATH, ~/.bun/bin, /usr/local/bin, /opt/homebrew/bin" >&2
exit 127
