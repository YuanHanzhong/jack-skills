#!/usr/bin/env bash
# Cross-platform compatibility checker (SessionStart hook)
# Detects common Windows compatibility issues in Claude Code config

ISSUES=()

# Only run checks on Windows
if [[ "$OS" != "Windows_NT" ]] && [[ "$(uname -s)" != MINGW* ]] && [[ "$(uname -s)" != MSYS* ]]; then
  exit 0
fi

CLAUDE_JSON="$HOME/.claude.json"
[[ -f "$CLAUDE_JSON" ]] || exit 0

# ── 1. MCP servers: bare npx/node/bun without cmd /c wrapper ──
BAD_MCPS=$(python3 -c "
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    data = json.load(f)
results = []
for name, cfg in data.get('mcpServers', {}).items():
    cmd = cfg.get('command', '')
    if cmd in ('npx', 'node', 'bun') and cfg.get('type') == 'stdio':
        results.append(f'  global/{name}: command={cmd}')
for proj, pcfg in data.get('projects', {}).items():
    for name, cfg in pcfg.get('mcpServers', {}).items():
        cmd = cfg.get('command', '')
        if cmd in ('npx', 'node', 'bun') and cfg.get('type') == 'stdio':
            results.append(f'  {proj}/{name}: command={cmd}')
if results:
    print('\n'.join(results))
" "$CLAUDE_JSON" 2>/dev/null)

if [[ -n "$BAD_MCPS" ]]; then
  ISSUES+=("MCP servers need 'cmd /c' wrapper on Windows:\n$BAD_MCPS")
fi

# ── 2. Scripts using 'python' shebang (should be python3) ──
if [[ -d ".claude/hooks" ]]; then
  for f in .claude/hooks/*.sh; do
    [[ -f "$f" ]] || continue
    if head -1 "$f" | grep -q "#!/usr/bin/env python$" 2>/dev/null; then
      ISSUES+=("$f: shebang uses 'python' — use 'python3' on Windows")
    fi
  done
fi

# ── 3. Path separator issues in config files ──
if [[ -f ".claude/settings.json" ]]; then
  if grep -q '\' ".claude/settings.json" 2>/dev/null; then
    ISSUES+=(".claude/settings.json contains backslash paths — use forward slashes")
  fi
fi

# ── 4. MCP servers: known bad npm package names (auto-fix) ──
# Maps wrong package → correct package. Extend KNOWN_FIXES as new cases arise.
# History: @anthropic/mcp-sqlite (404) → mcp-sqlite (2026-03-12)
FIX_RESULT=$(node -e "
const fs = require('fs');
const path = process.env.HOME + '/.claude.json';
if (!fs.existsSync(path)) process.exit(0);

const KNOWN_FIXES = {
  '@anthropic/mcp-sqlite': 'mcp-sqlite',
};

const d = JSON.parse(fs.readFileSync(path, 'utf8'));
const fixed = [];

function fixServers(servers, scope) {
  if (!servers) return;
  for (const [name, cfg] of Object.entries(servers)) {
    const args = cfg.args || [];
    const npxIdx = args.lastIndexOf('npx');
    if (npxIdx < 0) continue;
    let pkgIdx = npxIdx + 1;
    if (args[pkgIdx] === '-y') pkgIdx++;
    const pkg = args[pkgIdx];
    if (pkg && KNOWN_FIXES[pkg]) {
      args[pkgIdx] = KNOWN_FIXES[pkg];
      fixed.push(scope + '/' + name + ': ' + pkg + ' -> ' + KNOWN_FIXES[pkg]);
    }
  }
}

fixServers(d.mcpServers, 'global');
for (const [proj, pcfg] of Object.entries(d.projects || {})) {
  fixServers(pcfg.mcpServers, proj);
}

if (fixed.length > 0) {
  fs.writeFileSync(path, JSON.stringify(d, null, 2), 'utf8');
  console.log(fixed.join('\n'));
}
" 2>/dev/null)

if [[ -n "$FIX_RESULT" ]]; then
  echo "MCP auto-fixed bad package names:"
  while IFS= read -r line; do
    echo "  fix: $line"
  done <<< "$FIX_RESULT"
fi

# ── 5. CRLF fix moved to fix-compat.sh (PostToolUse) for zero startup overhead ──

# ── Output ──
if [[ ${#ISSUES[@]} -gt 0 ]]; then
  echo "Platform compat issues found:"
  for issue in "${ISSUES[@]}"; do
    echo -e "  - $issue"
  done
fi
