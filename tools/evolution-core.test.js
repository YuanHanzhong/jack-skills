import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  analyzeEvolution,
  analyzeTriggers,
  classifyKnowledgeRoute,
  formatMarkdownReport,
} from './evolution-core.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-evolve-'));

  mkdirSync(join(root, '00_DIM', 'rules'), { recursive: true });
  mkdirSync(join(root, '03_DWS', 'sessions', '项目开发'), { recursive: true });
  mkdirSync(join(root, '.agents', 'skills', 'debug-flow'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });

  writeFileSync(
    join(root, '00_DIM', 'memory.md'),
    [
      '# 项目记忆',
      '',
      '用户偏好：明确任务时先确认 Why。',
      '',
      '临时 TODO：明天继续看某个报错。',
      '',
      '§',
      '',
      '规则稳定事实：流程写入 skill，任务写入 ADS。',
    ].join('\n')
  );

  writeFileSync(
    join(root, '00_DIM', 'rules', '重复规则A.md'),
    [
      '---',
      'type: rule',
      '---',
      '',
      '# 搜索规范',
      '',
      '优先使用 rg。',
    ].join('\n')
  );

  writeFileSync(
    join(root, '00_DIM', 'rules', '重复规则B.md'),
    [
      '---',
      'type: rule',
      '---',
      '',
      '# 搜索规范',
      '',
      '不要使用 grep -r。',
    ].join('\n')
  );

  writeFileSync(
    join(root, '03_DWS', 'sessions', '项目开发', '26-0508-12-排障流程.md'),
    [
      '# 排障流程',
      '',
      '这次修复后形成了稳定步骤：先复现，再定位根因，最后补测试。',
      '',
      '下次遇到同类问题可以复用这个流程。',
    ].join('\n')
  );

  writeFileSync(
    join(root, '.agents', 'skills', 'debug-flow', 'SKILL.md'),
    [
      '---',
      'name: debug-flow',
      'description: 用于系统化排障',
      '---',
      '',
      '# Debug Flow',
    ].join('\n')
  );

  writeFileSync(
    join(root, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [],
        PreToolUse: [
          {
            matcher: 'Write|Edit',
            hooks: [],
          },
          {
            matcher: 'Bash',
            hooks: [],
          },
        ],
        Stop: [],
      },
    }, null, 2)
  );

  return root;
}

describe('evolution-core', () => {
  test('classifies knowledge routes with Hermes-style boundaries', () => {
    expect(classifyKnowledgeRoute('用户反复纠正：回答要先确认 Why').target).toBe('memory');
    expect(classifyKnowledgeRoute('这是一套成功排障流程，下次可复用').target).toBe('skill');
    expect(classifyKnowledgeRoute('新增约束：禁止修改 01_ODS 原始资料').target).toBe('rule');
    expect(classifyKnowledgeRoute('本轮任务进度：完成第一步').target).toBe('ads');
    expect(classifyKnowledgeRoute('今天会话总结：讨论了 Hermes 机制').target).toBe('dws');
  });

  test('finds memory pollution, duplicate rules, and skill candidates', () => {
    const root = makeFixture();
    const report = analyzeEvolution({ rootDir: root });

    expect(report.memory.issues.some((item) => item.type === 'volatile-memory')).toBe(true);
    expect(report.rules.duplicates).toHaveLength(1);
    expect(report.rules.duplicates[0].title).toBe('搜索规范');
    expect(report.sessions.skillCandidates).toHaveLength(1);
    expect(report.sessions.skillCandidates[0].reason).toContain('可复用流程');
  });

  test('formats a markdown report for review before any write operation', () => {
    const root = makeFixture();
    const report = analyzeEvolution({ rootDir: root });
    const markdown = formatMarkdownReport(report);

    expect(markdown).toContain('# 自我进化只读报告');
    expect(markdown).toContain('重复规则');
    expect(markdown).toContain('可技能化会话');
    expect(markdown).toContain('所有建议默认只读');
  });

  test('accepts zero default hooks as the healthy trigger posture', () => {
    const root = makeFixture();
    const triggers = analyzeTriggers({ rootDir: root });

    expect(triggers.issues.some((item) => item.type === 'unexpected-default-hooks')).toBe(false);
  });
});
