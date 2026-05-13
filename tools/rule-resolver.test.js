import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveRules } from './rule-resolver.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-rule-resolver-'));
  mkdirSync(join(root, '00_DIM', 'rules'), { recursive: true });
  mkdirSync(join(root, 'tools'), { recursive: true });

  writeFileSync(
    join(root, '00_DIM', 'rules', '实时对话记录规范.md'),
    [
      '# 实时对话记录规范',
      '',
      '断点续传内容由大模型提炼，代码只负责写入动作。',
    ].join('\n')
  );
  writeFileSync(
    join(root, '00_DIM', 'rules', '分层规则.md'),
    [
      '# 分层规则',
      '',
      '所有文档必须放在编号架构内。',
      '禁止在架构外创建 Markdown 文档。',
    ].join('\n')
  );
  writeFileSync(
    join(root, '00_DIM', 'rules', '问题修复规范.md'),
    [
      '# 问题修复规范',
      '',
      '最小样本修复通过后，必须搜索同类型问题，并批量修复同类问题。',
      '不同类别问题只记录为后续任务，不在同一轮混修。',
    ].join('\n')
  );
  writeFileSync(
    join(root, 'tools', 'rule-auditor-config.json'),
    JSON.stringify({ auditors: [], checklists: [] }, null, 2)
  );

  return root;
}

describe('rule-resolver', () => {
  test('returns model-owned checkpoint rules for checkpoint queries', async () => {
    const result = await resolveRules({
      rootDir: makeFixture(),
      query: '断点续传 checkpoint',
      limit: 3,
    });

    expect(result.matches).toContainEqual(
      expect.objectContaining({
        ruleFile: '00_DIM/rules/实时对话记录规范.md',
        enforcement: 'model_semantic',
      })
    );
    expect(result.matches[0].summary).toContain('断点续传');
  });

  test('ranks Chinese no-space architecture queries toward layer rules', async () => {
    const result = await resolveRules({
      rootDir: makeFixture(),
      query: '编号架构外 Markdown',
      limit: 3,
    });

    expect(result.matches[0]).toEqual(
      expect.objectContaining({
        ruleFile: '00_DIM/rules/分层规则.md',
      })
    );
  });

  test('finds same-class batch repair rules for defect-class queries', async () => {
    const result = await resolveRules({
      rootDir: makeFixture(),
      query: '同类型 批量修复 最小样本',
      limit: 3,
    });

    expect(result.matches[0]).toEqual(
      expect.objectContaining({
        ruleFile: '00_DIM/rules/问题修复规范.md',
      })
    );
  });
});
