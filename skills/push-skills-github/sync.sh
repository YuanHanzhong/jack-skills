#!/usr/bin/env bash
# sync.sh — 全量同步 Claude 配置到 jack-skills 仓库
# 来源：skills / tools / hooks / agents / memory / settings / install 脚本
set +e

REPO_ROOT=$(git rev-parse --show-toplevel)
SRC="$REPO_ROOT/.claude/skills"
DST="${JACK_SKILLS_DIR:-$(dirname "$REPO_ROOT")/jack-skills}"
EXCLUDE="node_modules|bun.lock|MIGRATION_CHECKPOINT.md|_zips"

echo "同步目标：$DST"
echo ""

# ── 1. Skills ──────────────────────────────────────────────────────────────
echo "=== [1/7] Skills ==="
if [ -f "$SRC/_shared/sync.sh" ]; then
  bash "$SRC/_shared/sync.sh" 2>&1 | grep -E "Done|Error" || true
fi

mkdir -p "$DST/skills"
for dir in "$SRC"/*/; do
  name=$(basename "$dir")
  [[ "$name" =~ ^($EXCLUDE)$ ]] && continue
  rm -rf "$DST/skills/$name"
  cp -r "$dir" "$DST/skills/$name"
  echo "  + skills/$name"
done
for f in "$SRC"/*.json "$SRC"/*.ts; do
  [ -f "$f" ] && cp "$f" "$DST/skills/" && echo "  + skills/$(basename "$f")"
done

# ── 2. Tools ───────────────────────────────────────────────────────────────
echo ""
echo "=== [2/7] Tools ==="
TOOLS_SRC="${HOME}/.claude/tools"
if [ -d "$TOOLS_SRC" ]; then
  mkdir -p "$DST/tools"
  rm -rf "$DST/tools"/*
  for f in "$TOOLS_SRC"/*; do
    [ -f "$f" ] && cp "$f" "$DST/tools/" && echo "  + tools/$(basename "$f")"
  done
else
  echo "  (skip: ~/.claude/tools not found)"
fi

# ── 3. Hooks（项目级 + 系统级）────────────────────────────────────────────
echo ""
echo "=== [3/7] Hooks ==="
PROJ_HOOKS="$REPO_ROOT/.claude/hooks"
SYS_HOOKS="${HOME}/.claude/hooks"
if [ -d "$PROJ_HOOKS" ]; then
  mkdir -p "$DST/hooks/project"
  rm -rf "$DST/hooks/project"/*
  cp -r "$PROJ_HOOKS"/. "$DST/hooks/project/"
  echo "  + hooks/project/ ($(ls "$PROJ_HOOKS" | wc -l | tr -d ' ') files)"
fi
if [ -d "$SYS_HOOKS" ]; then
  mkdir -p "$DST/hooks/system"
  rm -rf "$DST/hooks/system"/*
  cp -r "$SYS_HOOKS"/. "$DST/hooks/system/"
  echo "  + hooks/system/ ($(ls "$SYS_HOOKS" | wc -l | tr -d ' ') files)"
fi

# ── 4. Agents（项目级）────────────────────────────────────────────────────
echo ""
echo "=== [4/7] Agents ==="
PROJ_AGENTS="$REPO_ROOT/.claude/agents"
if [ -d "$PROJ_AGENTS" ]; then
  mkdir -p "$DST/agents"
  rm -rf "$DST/agents"/*
  cp -r "$PROJ_AGENTS"/. "$DST/agents/"
  echo "  + agents/ ($(ls "$PROJ_AGENTS" | wc -l | tr -d ' ') files)"
else
  echo "  (skip: .claude/agents not found)"
fi

# ── 5. Memory（项目级 + 系统级）───────────────────────────────────────────
echo ""
echo "=== [5/7] Memory ==="
PROJ_MEM=""
for candidate in \
  "C:/Users/jack/.claude/projects/E--GitHub-3-simple/memory" \
  "/c/Users/jack/.claude/projects/E--GitHub-3-simple/memory"; do
  [ -d "$candidate" ] && PROJ_MEM="$candidate" && break
done
if [ -n "$PROJ_MEM" ]; then
  mkdir -p "$DST/memory/project"
  rm -rf "$DST/memory/project"/*
  cp -r "$PROJ_MEM"/. "$DST/memory/project/"
  echo "  + memory/project/ ($(ls "$PROJ_MEM" | wc -l | tr -d ' ') files)"
else
  echo "  (skip: project memory not found)"
fi

SYS_MEM="${HOME}/.claude/memory"
if [ -d "$SYS_MEM" ]; then
  mkdir -p "$DST/memory/system"
  rm -rf "$DST/memory/system"/*
  cp -r "$SYS_MEM"/. "$DST/memory/system/"
  echo "  + memory/system/ ($(ls "$SYS_MEM" | wc -l | tr -d ' ') files)"
else
  echo "  (skip: ~/.claude/memory not found)"
fi

# ── 6. Settings（项目级 + 系统级 settings.json）──────────────────────────
echo ""
echo "=== [6/7] Settings ==="
mkdir -p "$DST/settings"

# 项目级 settings.json
PROJ_SETTINGS="$REPO_ROOT/.claude/settings.json"
if [ -f "$PROJ_SETTINGS" ]; then
  cp "$PROJ_SETTINGS" "$DST/settings/project-settings.json"
  echo "  + settings/project-settings.json"
fi

# 系统级 settings.json
SYS_SETTINGS="${HOME}/.claude/settings.json"
if [ -f "$SYS_SETTINGS" ]; then
  cp "$SYS_SETTINGS" "$DST/settings/system-settings.json"
  echo "  + settings/system-settings.json"
fi

# .gitattributes
if [ -f "$REPO_ROOT/.gitattributes" ]; then
  cp "$REPO_ROOT/.gitattributes" "$DST/settings/gitattributes"
  echo "  + settings/gitattributes"
fi

# CLAUDE.md
if [ -f "$REPO_ROOT/CLAUDE.md" ]; then
  cp "$REPO_ROOT/CLAUDE.md" "$DST/settings/CLAUDE.md"
  echo "  + settings/CLAUDE.md"
fi

# ── 7. Install script ────────────────────────────────────────────────────
echo ""
echo "=== [7/7] Install script ==="
# install.sh 由 SKILL.md 维护，存在于 push-skills-github 目录下
INSTALL_SRC="$SRC/push-skills-github/install.sh"
if [ -f "$INSTALL_SRC" ]; then
  cp "$INSTALL_SRC" "$DST/install.sh"
  echo "  + install.sh (one-key setup)"
else
  echo "  (warn: install.sh not found in push-skills-github/)"
fi

echo ""
echo "Done. Target:"
ls "$DST"
