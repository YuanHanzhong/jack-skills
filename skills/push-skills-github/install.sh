#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# install.sh — jack-skills 一键环境安装
# 用法: bash install.sh [TARGET_PROJECT_ROOT]
#
# 功能：
#   1. 将 skills/hooks/tools/agents/memory/settings 安装到正确位置
#   2. 执行 Windows 兼容性修复（setup-windows.sh）
#   3. 配置 VS Code UTF-8、CRLF 修复、hookify UTF-8 补丁
#
# 在新机器上 clone jack-skills 后执行一次即可：
#   git clone https://github.com/YuanHanzhong/jack-skills.git
#   cd jack-skills && bash install.sh /path/to/your/project
# ═══════════════════════════════════════════════════════════════════════════
set +e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_ROOT="${1:-.}"
TARGET_ROOT="$(cd "$TARGET_ROOT" 2>/dev/null && pwd || echo "$TARGET_ROOT")"

echo "═══════════════════════════════════════════════"
echo "  jack-skills installer"
echo "═══════════════════════════════════════════════"
echo "  Source:  $SCRIPT_DIR"
echo "  Target:  $TARGET_ROOT"
echo ""

INSTALLED=0

# ── Helper ────────────────────────────────────────────────────────────────
install_dir() {
  local src="$1" dst="$2" label="$3"
  if [ -d "$src" ] && [ "$(ls -A "$src" 2>/dev/null)" ]; then
    mkdir -p "$dst"
    cp -r "$src"/. "$dst/"
    echo "  [ok] $label -> $dst"
    INSTALLED=$((INSTALLED + 1))
  else
    echo "  [--] $label (source empty, skip)"
  fi
}

install_file() {
  local src="$1" dst="$2" label="$3"
  if [ -f "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "  [ok] $label"
    INSTALLED=$((INSTALLED + 1))
  fi
}

# ── 1. Skills → project .claude/skills/ ──────────────────────────────────
echo "=== [1/6] Skills ==="
if [ -d "$SCRIPT_DIR/skills" ]; then
  mkdir -p "$TARGET_ROOT/.claude/skills"
  for dir in "$SCRIPT_DIR/skills"/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    rm -rf "$TARGET_ROOT/.claude/skills/$name"
    cp -r "$dir" "$TARGET_ROOT/.claude/skills/$name"
    echo "  [ok] skills/$name"
    INSTALLED=$((INSTALLED + 1))
  done
  # Root config files (package.json, tsconfig.json)
  for f in "$SCRIPT_DIR/skills"/*.json "$SCRIPT_DIR/skills"/*.ts; do
    [ -f "$f" ] && cp "$f" "$TARGET_ROOT/.claude/skills/"
  done
fi

# ── 2. Tools → ~/.claude/tools/ ──────────────────────────────────────────
echo ""
echo "=== [2/6] Tools ==="
install_dir "$SCRIPT_DIR/tools" "$HOME/.claude/tools" "tools"

# ── 3. Hooks ─────────────────────────────────────────────────────────────
echo ""
echo "=== [3/6] Hooks ==="
install_dir "$SCRIPT_DIR/hooks/project" "$TARGET_ROOT/.claude/hooks" "hooks/project"
install_dir "$SCRIPT_DIR/hooks/system"  "$HOME/.claude/hooks"        "hooks/system"

# ── 4. Agents → project .claude/agents/ ──────────────────────────────────
echo ""
echo "=== [4/6] Agents ==="
install_dir "$SCRIPT_DIR/agents" "$TARGET_ROOT/.claude/agents" "agents"

# ── 5. Settings ──────────────────────────────────────────────────────────
echo ""
echo "=== [5/6] Settings ==="

# project settings.json
install_file "$SCRIPT_DIR/settings/project-settings.json" \
             "$TARGET_ROOT/.claude/settings.json" \
             "project settings.json"

# system settings.json — merge hooks, don't overwrite plugins/other config
SYS_SETTINGS="$HOME/.claude/settings.json"
SRC_SYS="$SCRIPT_DIR/settings/system-settings.json"
if [ -f "$SRC_SYS" ]; then
  if [ -f "$SYS_SETTINGS" ]; then
    # Existing system settings: only update hooks section, preserve rest
    node -e "
const fs = require('fs');
const src = JSON.parse(fs.readFileSync('$SRC_SYS', 'utf8'));
const dst = JSON.parse(fs.readFileSync('$SYS_SETTINGS', 'utf8'));
dst.hooks = src.hooks;
if (src.statusLine) dst.statusLine = src.statusLine;
fs.writeFileSync('$SYS_SETTINGS', JSON.stringify(dst, null, 2), 'utf8');
console.log('  [ok] system settings.json (hooks merged)');
" 2>/dev/null || echo "  [warn] could not merge system settings, copying..."
  else
    mkdir -p "$HOME/.claude"
    cp "$SRC_SYS" "$SYS_SETTINGS"
    echo "  [ok] system settings.json (new)"
  fi
  INSTALLED=$((INSTALLED + 1))
fi

# .gitattributes
install_file "$SCRIPT_DIR/settings/gitattributes" \
             "$TARGET_ROOT/.gitattributes" \
             ".gitattributes"

# CLAUDE.md
install_file "$SCRIPT_DIR/settings/CLAUDE.md" \
             "$TARGET_ROOT/CLAUDE.md" \
             "CLAUDE.md"

# ── 6. Memory (project) ─────────────────────────────────────────────────
echo ""
echo "=== [6/6] Memory ==="
# Detect project memory path from target root
# Convert path: E:/GitHub/3_simple -> E--GitHub-3-simple
TARGET_NORM=$(echo "$TARGET_ROOT" | sed 's|^/\([a-zA-Z]\)/|\U\1--|; s|/|-|g; s|:||g')
PROJ_MEM_DIR="$HOME/.claude/projects/$TARGET_NORM/memory"
if [ -d "$SCRIPT_DIR/memory/project" ]; then
  mkdir -p "$PROJ_MEM_DIR"
  cp -r "$SCRIPT_DIR/memory/project"/. "$PROJ_MEM_DIR/"
  echo "  [ok] memory/project -> $PROJ_MEM_DIR"
  INSTALLED=$((INSTALLED + 1))
fi

# ── 7. Windows Setup (auto-detect) ──────────────────────────────────────
echo ""
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    echo "=== Windows detected — running setup ==="
    SETUP_SCRIPT="$HOME/.claude/hooks/setup-windows.sh"
    if [ -f "$SETUP_SCRIPT" ]; then
      bash "$SETUP_SCRIPT"
    else
      echo "  [warn] setup-windows.sh not found in ~/.claude/hooks/"
      echo "  Expected at: $SETUP_SCRIPT"
    fi
    ;;
  *)
    echo "=== Non-Windows platform — skipping Windows setup ==="
    ;;
esac

echo ""
echo "═══════════════════════════════════════════════"
echo "  Done: $INSTALLED components installed"
echo "═══════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Restart VS Code terminal (for encoding changes)"
echo "  2. Open Claude Code in the project directory"
echo "  3. If plugins missing, install from marketplace"
echo ""
