import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { formatHistoryFormatAudit, runHistoryFormatAudit } from './history-format-audit.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-history-format-audit-'));
  mkdirSync(join(root, '01_ODS'), { recursive: true });
  mkdirSync(join(root, '02_DWD', 'topic'), { recursive: true });
  mkdirSync(join(root, '03_DWS', 'sessions'), { recursive: true });
  mkdirSync(join(root, '04_ADS', '2_进行中'), { recursive: true });

  writeFileSync(join(root, '01_ODS', 'raw.md'), 'raw material without h1');
  writeFileSync(join(root, '02_DWD', 'INDEX.md'), 'generated index');
  writeFileSync(join(root, '02_DWD', 'topic', 'README.md'), '# README\n');
  writeFileSync(
    join(root, '02_DWD', 'topic', 'good.md'),
    [
      '---',
      'canonical_id: good',
      'aliases:',
      '  - Good',
      'relations: []',
      '---',
      '# Good',
      '',
      '## 当前结论',
      '',
      '结论。',
      '',
      '## 精确时间线',
      '',
      '- 2026-05-08：记录。',
      '',
      '## 关联内容',
      '',
      '- 关联任务：无',
      '',
      '## 原始证据',
      '',
      '- 来源：测试',
      '',
    ].join('\n')
  );
  writeFileSync(
    join(root, '03_DWS', 'sessions', 'bad.md'),
    [
      '# Bad',
      '',
      '### 跳级标题',
      '',
      '```',
      'code',
      '```',
      '',
    ].join('\n')
  );
  writeFileSync(
    join(root, '04_ADS', '2_进行中', '26-0508-14-plan-task_plan-demo.md'),
    [
      '---',
      'canonical_id: demo',
      '---',
      '# Demo',
      '',
      '# Duplicate',
      '',
    ].join('\n')
  );

  return root;
}

describe('history-format-audit', () => {
  test('reports historical format debt without scanning ODS or generated files', async () => {
    const root = makeFixture();
    const report = await runHistoryFormatAudit({ rootDir: root });

    expect(report.scanned).toBe(3);
    expect(report.issueCount).toBe(14);
    expect(report.byLayer).toEqual({
      DWD: { files: 1, issues: 0 },
      DWS: { files: 1, issues: 7 },
      ADS: { files: 1, issues: 7 },
    });
    expect(report.files.map((file) => file.path)).toEqual([
      '02_DWD/topic/good.md',
      '03_DWS/sessions/bad.md',
      '04_ADS/2_进行中/26-0508-14-plan-task_plan-demo.md',
    ]);
    expect(report.files.find((file) => file.path.endsWith('bad.md')).issues).toEqual(
      expect.arrayContaining([
        '缺少 YAML frontmatter',
        '第 3 行标题跳级（H1 → H3）',
        '第 5 行代码块缺少语言标记',
        '缺少「当前结论」章节',
      ])
    );
    expect(report.files.find((file) => file.path.endsWith('task_plan-demo.md')).issues).toEqual(
      expect.arrayContaining([
        '有 2 个 H1 标题（应只有 1 个）',
        'YAML frontmatter 缺少 aliases',
        'YAML frontmatter 缺少 relations',
      ])
    );
  });

  test('formats a non-blocking markdown report', async () => {
    const root = makeFixture();
    const markdown = formatHistoryFormatAudit(await runHistoryFormatAudit({ rootDir: root }));

    expect(markdown).toContain('# 历史格式债 Full Audit');
    expect(markdown).toContain('> 本报告只读扫描历史 DWD/DWS/ADS，不进入 quick audit 阻断链路。');
    expect(markdown).toContain('| DWS | 1 | 7 |');
    expect(markdown).toContain('| ADS | 1 | 7 |');
    expect(markdown).toContain('03_DWS/sessions/bad.md');
    expect(markdown).not.toContain('01_ODS/raw.md');
  });

  test('filters by layer and can show only problem files', async () => {
    const root = makeFixture();
    const report = await runHistoryFormatAudit({
      rootDir: root,
      layer: 'ADS',
      problemsOnly: true,
    });

    expect(report.scanned).toBe(1);
    expect(report.issueCount).toBe(7);
    expect(report.byLayer).toEqual({
      DWD: { files: 0, issues: 0 },
      DWS: { files: 0, issues: 0 },
      ADS: { files: 1, issues: 7 },
    });
    expect(report.files.map((file) => file.path)).toEqual([
      '04_ADS/2_进行中/26-0508-14-plan-task_plan-demo.md',
    ]);
  });

  test('limits markdown details while preserving summary counts', async () => {
    const root = makeFixture();
    const markdown = formatHistoryFormatAudit(
      await runHistoryFormatAudit({ rootDir: root }),
      { limit: 1 }
    );

    expect(markdown).toContain('- 问题数量：14');
    expect(markdown).toContain('### 03_DWS/sessions/bad.md');
    expect(markdown).not.toContain('### 04_ADS/2_进行中/26-0508-14-plan-task_plan-demo.md');
    expect(markdown).toContain('- ...另 1 个问题文件未展开，可用 `--limit 0` 查看全部。');
  });
});
