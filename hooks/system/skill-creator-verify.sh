#!/bin/bash
# PostToolUse hook: after skill-creator runs, remind to verify code changes

SKILL_NAME=$(echo "$TOOL_INPUT" 2>/dev/null | grep -o '"skill"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"skill"[[:space:]]*:[[:space:]]*"//;s/"//')

if [[ "$SKILL_NAME" == *"skill-creator"* ]]; then
  echo "SKILL-CREATOR VERIFY: Every SKILL.md rule change must have matching code implementation in hooks/scripts/templates. Verify before continuing."
fi
