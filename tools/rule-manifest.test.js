import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildRuleManifest, formatRuleManifest } from './rule-manifest.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-rule-manifest-'));
  mkdirSync(join(root, '00_DIM', 'rules'), { recursive: true });
  mkdirSync(join(root, 'tools'), { recursive: true });

  writeFileSync(join(root, '00_DIM', 'rules', '分层规则.md'), '# 分层规则\n\n严禁修改 ODS。\n');
  writeFileSync(join(root, '00_DIM', 'rules', '文档写法规范.md'), '# 文档写法规范\n');
  writeFileSync(
    join(root, 'tools', 'rule-auditor-config.json'),
    JSON.stringify({
      auditors: [
        {
          id: 'ods-protection',
          name: 'ODS 保护',
          ruleFile: '00_DIM/rules/分层规则.md',
          module: './auditors/ods-protection.js',
          type: 'automated',
          quick: true,
        },
      ],
      checklists: [
        {
          id: 'document-style',
          name: '文档风格',
          ruleFile: '00_DIM/rules/文档写法规范.md',
          items: ['是否结论先行？'],
        },
      ],
    })
  );

  return root;
}

describe('rule-manifest', () => {
  test('builds a machine-readable manifest from rules and auditor config', async () => {
    const manifest = await buildRuleManifest({ rootDir: makeFixture() });

    expect(manifest.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ods-protection',
          ruleFile: '00_DIM/rules/分层规则.md',
          enforcement: 'code_enforced',
          tool: './auditors/ods-protection.js',
        }),
        expect.objectContaining({
          id: 'document-style',
          ruleFile: '00_DIM/rules/文档写法规范.md',
          enforcement: 'model_checklist',
        }),
      ])
    );
  });

  test('formats markdown manifest', async () => {
    const manifest = await buildRuleManifest({ rootDir: makeFixture() });
    const markdown = formatRuleManifest(manifest);

    expect(markdown).toContain('# 规则执行清单');
    expect(markdown).toContain('code_enforced');
    expect(markdown).toContain('model_checklist');
  });

  test('classifies semantic rules as model-owned instead of code extracted', async () => {
    const root = makeFixture();
    writeFileSync(
      join(root, '00_DIM', 'rules', '实时对话记录规范.md'),
      '# 实时对话记录规范\n\n断点续传内容由大模型提炼。\n'
    );

    const manifest = await buildRuleManifest({ rootDir: root });

    expect(manifest.rules).toContainEqual(
      expect.objectContaining({
        id: '实时对话记录规范',
        ruleFile: '00_DIM/rules/实时对话记录规范.md',
        enforcement: 'model_semantic',
      })
    );
  });
});
