#!/usr/bin/env bash
# Manual plugin marketplace update script
# Called from notion-organizer skill instead of auto-pulling on startup
set -euo pipefail

MARKETPLACES_DIR="$HOME/.claude/plugins/marketplaces"

updated=0
failed=0

for dir in "$MARKETPLACES_DIR"/*/; do
  name=$(basename "$dir")
  if [ -d "$dir/.git" ]; then
    echo "[plugin-update] Pulling $name..."
    if git -C "$dir" pull --ff-only --quiet 2>/dev/null; then
      echo "[plugin-update] $name: OK"
      ((updated++))
    else
      echo "[plugin-update] $name: FAILED (network or conflict)"
      ((failed++))
    fi
  fi
done

echo "[plugin-update] Done: $updated updated, $failed failed"
