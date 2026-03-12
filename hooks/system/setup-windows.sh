#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# setup-windows.sh — Windows 环境一键初始化（手动执行一次即可）
# 用法: bash ~/.claude/hooks/setup-windows.sh
# 合并了原先散落在多个 SessionStart/PostToolUse hooks 中的一次性修复
# ═══════════════════════════════════════════════════════════════════
set +e

# Only run on Windows
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) echo "Not Windows, skipping."; exit 0 ;;
esac

FIXED=0
SKIPPED=0

log_fix()  { echo "  [fix] $1"; FIXED=$((FIXED + 1)); }
log_skip() { SKIPPED=$((SKIPPED + 1)); }

echo "══ Windows 环境初始化 ══"

# ── 1. VS Code terminal encoding: chcp 936 → 65001 ──
VSCODE_SETTINGS="${APPDATA:-$HOME/AppData/Roaming}/Code/User/settings.json"
if [[ -f "$VSCODE_SETTINGS" ]]; then
  if grep -q '"chcp 936"' "$VSCODE_SETTINGS" 2>/dev/null; then
    sed -i 's/"chcp 936"/"chcp 65001"/g' "$VSCODE_SETTINGS"
    log_fix "VS Code automationProfile: chcp 936 → 65001"
  else
    log_skip
  fi
else
  echo "  [skip] VS Code settings not found"
fi

# ── 2. CRLF line endings in all .sh/.py under ~/.claude/ ──
echo "  Scanning for CRLF scripts..."
CRLF_COUNT=0
while IFS= read -r -d '' f; do
  if file "$f" 2>/dev/null | grep -q CRLF; then
    sed -i 's/\r$//' "$f" 2>/dev/null
    CRLF_COUNT=$((CRLF_COUNT + 1))
  fi
done < <(find "$HOME/.claude" \( -name "*.sh" -o -name "*.py" \) -print0 2>/dev/null)
if [[ $CRLF_COUNT -gt 0 ]]; then
  log_fix "CRLF → LF: $CRLF_COUNT script(s)"
else
  log_skip
fi

# ── 3. MCP servers: bare npx/node/bun → cmd /c wrapper ──
CLAUDE_JSON="$HOME/.claude.json"
if [[ -f "$CLAUDE_JSON" ]]; then
  R3=$(node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('$CLAUDE_JSON', 'utf8'));
const NEEDS_WRAP = new Set(['npx', 'node', 'bun']);
const fixed = [];
function fixServers(servers, scope) {
  if (!servers) return;
  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.type !== 'stdio') continue;
    if (NEEDS_WRAP.has(cfg.command)) {
      cfg.args = ['/c', cfg.command, ...(cfg.args || [])];
      cfg.command = 'cmd';
      fixed.push(scope + '/' + name);
    }
  }
}
fixServers(d.mcpServers, 'global');
for (const [proj, pcfg] of Object.entries(d.projects || {})) {
  fixServers(pcfg.mcpServers, proj);
}
if (fixed.length) {
  fs.writeFileSync('$CLAUDE_JSON', JSON.stringify(d, null, 2), 'utf8');
  console.log(fixed.join(', '));
}
" 2>/dev/null)
  if [[ -n "$R3" ]]; then
    log_fix "MCP cmd /c wrapper: $R3"
  else
    log_skip
  fi

  # ── 4. MCP servers: known bad npm package names ──
  R4=$(node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('$CLAUDE_JSON', 'utf8'));
const KNOWN_FIXES = { '@anthropic/mcp-sqlite': 'mcp-sqlite' };
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
      fixed.push(scope + '/' + name + ': ' + pkg + ' → ' + KNOWN_FIXES[pkg]);
    }
  }
}
fixServers(d.mcpServers, 'global');
for (const [proj, pcfg] of Object.entries(d.projects || {})) {
  fixServers(pcfg.mcpServers, proj);
}
if (fixed.length) {
  fs.writeFileSync('$CLAUDE_JSON', JSON.stringify(d, null, 2), 'utf8');
  console.log(fixed.join(', '));
}
" 2>/dev/null)
  if [[ -n "$R4" ]]; then
    log_fix "MCP bad package: $R4"
  else
    log_skip
  fi
fi

# ── 5. python shebang → python3 ──
for hook_dir in "$HOME/.claude/hooks" ".claude/hooks"; do
  [[ -d "$hook_dir" ]] || continue
  for f in "$hook_dir"/*.sh; do
    [[ -f "$f" ]] || continue
    if head -1 "$f" 2>/dev/null | grep -q "#!/usr/bin/env python$"; then
      sed -i '1s|#!/usr/bin/env python$|#!/usr/bin/env python3|' "$f" 2>/dev/null
      log_fix "shebang: $f → python3"
    fi
  done
done

# ── 6. Hookify UTF-8 stdin patch ──
HOOKIFY_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/hookify"
if [[ -d "$HOOKIFY_DIR" ]]; then
  R6=$(python3 -c "
import os, glob
hookify_dir = os.path.expanduser('~/.claude/plugins/cache/claude-plugins-official/hookify')
marker = '# Fix Windows stdin encoding'
patch = '''import io
# Fix Windows stdin encoding: force UTF-8 instead of system default (cp936/GBK)
if sys.platform == 'win32' and hasattr(sys.stdin, 'buffer'):
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
'''
patched = 0
skipped = 0
for py_file in glob.glob(os.path.join(hookify_dir, '**', 'hooks', '*.py'), recursive=True):
    if os.path.basename(py_file) == '__init__.py': continue
    with open(py_file, 'r', encoding='utf-8') as f: content = f.read()
    if marker in content: skipped += 1; continue
    if 'import json' not in content: continue
    new_content = content.replace('import json\n', 'import json\n\n' + patch, 1)
    with open(py_file, 'w', encoding='utf-8') as f: f.write(new_content)
    patched += 1
print(f'{patched} patched, {skipped} already OK')
" 2>/dev/null)
  if [[ "$R6" == "0 patched"* ]]; then
    log_skip
  else
    log_fix "Hookify UTF-8: $R6"
  fi
fi

echo ""
echo "══ Done: $FIXED fixed, $SKIPPED already OK ══"
if [[ $FIXED -gt 0 ]]; then
  echo "Restart VS Code terminal for encoding changes to take effect."
fi
