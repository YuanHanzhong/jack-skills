#!/bin/bash
# SessionStart hook: check MEMORY.md line count, warn Claude to compress if too long.
# Claude Code loads only the first 200 lines of MEMORY.md — content beyond that is invisible.
# Perf: use wc -c for fast size check first, skip wc -l if file is small.

# Auto-detect project memory path (works on both Windows and macOS)
MEMORY_FILE=""
for candidate in "$HOME/.claude/projects/"*3?simple*/memory/MEMORY.md \
                 "$HOME/.claude/projects/"*3_simple*/memory/MEMORY.md; do
  [ -f "$candidate" ] && MEMORY_FILE="$candidate" && break
done
WARN_THRESHOLD=150
CRITICAL_THRESHOLD=180

# Fast exit: no memory file found
[ -n "$MEMORY_FILE" ] || exit 0

# Fast pre-check: if file < 9KB, definitely under 150 lines (avg 60 chars/line × 150 = 9000)
FILE_SIZE=$(wc -c < "$MEMORY_FILE")
[ "$FILE_SIZE" -lt 9000 ] && exit 0

# File is large enough to potentially exceed threshold — count lines
LINE_COUNT=$(wc -l < "$MEMORY_FILE")

if [ "$LINE_COUNT" -ge "$CRITICAL_THRESHOLD" ]; then
  cat <<EOF
⚠️ MEMORY.md 已达 ${LINE_COUNT} 行（上限 200 行，超出部分不可见）。
请立即压缩 MEMORY.md：
1. 读取完整文件
2. 按以下优先级保留内容：
   - 高频使用的规则（Notion MCP 规范、runtime 优先级等）→ 保留原文
   - 中频参考信息（项目结构、共享模块表等）→ 压缩为一行摘要
   - 低频或过时信息（已解决的一次性问题）→ 移到 topic 文件或删除
3. 详细内容移到 memory/ 下的 topic 文件（如 notion-api.md、wsl-setup.md）
4. MEMORY.md 中保留指向 topic 文件的链接
5. 目标：压缩到 120 行以内
EOF
elif [ "$LINE_COUNT" -ge "$WARN_THRESHOLD" ]; then
  echo "📋 MEMORY.md 当前 ${LINE_COUNT}/200 行。接近上限，注意控制长度。新增内容时考虑是否需要压缩旧条目。"
fi

exit 0
