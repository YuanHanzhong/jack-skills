#!/usr/bin/env bash
# SessionStart hook: auto-patch plugins for Windows compatibility
# 1. Fix CRLF line endings in all plugin .sh/.py files (prevents "cannot execute binary file")
# 2. Patch hookify Python files for UTF-8 stdin (prevents cp936/GBK encoding errors)

# CRLF fix moved to fix-compat.sh (PostToolUse) — zero startup overhead
# This script only handles hookify UTF-8 patching now.

HOOKIFY_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/hookify"

if [ ! -d "$HOOKIFY_DIR" ]; then
  exit 0
fi

python3 -c "
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
    if os.path.basename(py_file) == '__init__.py':
        continue
    with open(py_file, 'r', encoding='utf-8') as f:
        content = f.read()
    if marker in content:
        skipped += 1
        continue
    if 'import json' not in content:
        continue
    new_content = content.replace('import json\n', 'import json\n\n' + patch, 1)
    with open(py_file, 'w', encoding='utf-8') as f:
        f.write(new_content)
    patched += 1

if patched > 0:
    print(f'Hookify UTF-8 patch: {patched} files patched, {skipped} already OK')
else:
    print(f'Hookify UTF-8 patch: all {skipped} files OK')
"
