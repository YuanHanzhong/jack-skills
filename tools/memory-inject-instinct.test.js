import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('memory-inject instinct trigger', () => {
  test('injects learned mistakes even when vector memory hooks are disabled', () => {
    const root = mkdtempSync(join(tmpdir(), 'kms-instinct-'));
    const instinctsDir = join(root, '.memory', 'instincts');
    mkdirSync(instinctsDir, { recursive: true });
    writeFileSync(
      join(instinctsDir, 'bash-sed-js-blocked.md'),
      [
        '---',
        'id: bash-sed-js-blocked',
        'trigger: "Bash 工具中用 sed/awk 编辑 .js 文件"',
        'rule: R5',
        'confidence: 0.95',
        'count: 2',
        'last_seen: "2026-05-08 12:00"',
        '---',
        '',
        '# 错误模式：Bash 工具中用 sed/awk 编辑 .js 文件',
        '',
        '## 正确做法',
        '使用 Edit 或 apply_patch 修改 JavaScript 文件。',
      ].join('\n')
    );

    const result = spawnSync('bun', ['.claude/hooks/memory-inject.js'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_ROOT: root,
        USER_PROMPT: '帮我修改脚本里的规则执行逻辑',
        KMS_ENABLE_MEMORY_HOOKS: '',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('已学习的错误模式');
    expect(result.stdout).toContain('sed/awk');
  });
});
