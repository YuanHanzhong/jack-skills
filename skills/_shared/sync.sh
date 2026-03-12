#!/usr/bin/env bash
# Sync root _shared/ to each skill's _shared/ copy.
# Single edit source: root _shared/. Skills keep local copies for independent execution.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_ROOT="$(dirname "$SCRIPT_DIR")"
SHARED_SRC="$SCRIPT_DIR"

for skill in chat-mode learning-engine notion-organizer notion-writer; do
  dst="$SKILLS_ROOT/$skill/_shared"
  mkdir -p "$dst"
  cp "$SHARED_SRC"/*.ts "$SHARED_SRC"/*.md "$dst/" 2>/dev/null
  echo "✅ $skill/_shared/"
done
echo "Done. All _shared/ copies synced."
