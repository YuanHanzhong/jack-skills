#!/usr/bin/env bash
# Auto-fix compatibility issues after file edits (PostToolUse: Edit|Write)
# Only keeps rules that genuinely need per-edit checking.
# One-time fixes (MCP cmd/c, CRLF bulk scan, shebang, chcp) → setup-windows.sh

# Only run on Windows
if [[ "$OS" != "Windows_NT" ]] && [[ "$(uname -s)" != MINGW* ]] && [[ "$(uname -s)" != MSYS* ]]; then
  exit 0
fi

FIXED=()

# ── Rule 1. CRLF in just-edited .sh/.py files ──
# Only check the specific file that was edited (via CLAUDE_TOOL_INPUT), not a full scan.
# Fallback: check project .claude/ dir (lightweight, ~10 files).
if [[ -d ".claude" ]]; then
  while IFS= read -r -d '' f; do
    if file "$f" 2>/dev/null | grep -q CRLF; then
      sed -i 's/\r$//' "$f" 2>/dev/null
      FIXED+=("[crlf] $f")
    fi
  done < <(find ".claude" \( -name "*.sh" -o -name "*.py" \) -print0 2>/dev/null)
fi

# ── Rule 2. settings.json: backslash paths ──
if [[ -f ".claude/settings.json" ]]; then
  if grep -qP '(?<!\\)\\(?!\\|n|t|r|")' ".claude/settings.json" 2>/dev/null; then
    FIXED+=("[paths] .claude/settings.json may contain backslash paths")
  fi
fi

# ── Output (silent if nothing to fix) ──
if [[ ${#FIXED[@]} -gt 0 ]]; then
  echo "fix-compat: ${#FIXED[@]} issue(s):"
  for msg in "${FIXED[@]}"; do
    echo "  $msg"
  done
fi
