import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import whitelistConsistency from './auditors/whitelist-consistency.js';

function makeFixture({ allow }) {
  const root = mkdtempSync(join(tmpdir(), 'kms-whitelist-'));
  mkdirSync(join(root, '00_DIM', 'rules'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(
    join(root, '00_DIM', 'rules', '命令白名单.md'),
    [
      '# 命令白名单',
      '',
      '- 任意 Bash 命令 — 直接执行',
      '- `git push`：永远不自动执行',
    ].join('\n')
  );
  writeFileSync(
    join(root, '.claude', 'settings.local.json'),
    JSON.stringify({ permissions: { allow } }, null, 2)
  );
  return root;
}

describe('whitelist-consistency auditor', () => {
  test('does not warn for non-Bash tool permissions documented outside command whitelist', async () => {
    const root = makeFixture({
      allow: [
        'Bash(bun:*)',
        'WebSearch',
        'WebFetch(domain:github.com)',
        'mcp__web-reader__*',
      ],
    });

    const result = await whitelistConsistency.check(root);

    expect(result.status).toBe('pass');
  });
});
