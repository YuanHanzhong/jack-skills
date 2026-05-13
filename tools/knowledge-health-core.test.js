import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { analyzeKnowledgeHealth, formatKnowledgeHealthReport } from './knowledge-health-core.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-health-'));

  mkdirSync(join(root, '01_ODS', 'fromArticle'), { recursive: true });
  mkdirSync(join(root, '02_DWD', 'fromArticle'), { recursive: true });
  mkdirSync(join(root, '03_DWS', 'topics'), { recursive: true });
  mkdirSync(join(root, '04_ADS', '1_收集'), { recursive: true });
  mkdirSync(join(root, '04_ADS', '2_进行中'), { recursive: true });
  mkdirSync(join(root, '04_ADS', '3_已完成'), { recursive: true });

  writeFileSync(
    join(root, '01_ODS', 'fromArticle', 'stable-source.md'),
    [
      '---',
      'title: Stable Source',
      'sha256: a0b4151d674b31487acf346f68742269fd6fa2843e2996e54a907d243af14326',
      '---',
      'stable source body',
    ].join('\n')
  );

  writeFileSync(
    join(root, '01_ODS', 'fromArticle', 'drifted-source.md'),
    [
      '---',
      'title: Drifted Source',
      'sha256: wrong',
      '---',
      'changed body',
    ].join('\n')
  );

  writeFileSync(
    join(root, '02_DWD', 'fromArticle', 'concept-a.md'),
    [
      '---',
      'title: Concept A',
      'confidence: low',
      'contested: true',
      'sources: [01_ODS/fromArticle/stable-source.md]',
      '---',
      '# Concept A',
      '',
      '来自 [[concept-b]] 的对照。^[01_ODS/fromArticle/stable-source.md]',
    ].join('\n')
  );

  writeFileSync(
    join(root, '02_DWD', 'fromArticle', 'concept-b.md'),
    [
      '---',
      'title: Concept B',
      'confidence: high',
      'sources: [01_ODS/fromArticle/stable-source.md]',
      '---',
      '# Concept B',
      '',
      '反向链接到 [[concept-a]]。',
    ].join('\n')
  );

  writeFileSync(
    join(root, '03_DWS', 'topics', 'orphan-topic.md'),
    [
      '---',
      'title: Orphan Topic',
      'confidence: medium',
      'sources: []',
      '---',
      '# Orphan Topic',
      '',
      '没有链接的主题页。',
    ].join('\n')
  );

  writeFileSync(join(root, '04_ADS', '1_收集', '26-0508-12-plan-task_plan-a.md'), '# A\n');
  writeFileSync(join(root, '04_ADS', '2_进行中', '26-0508-12-exec-progress-b.md'), '# B\n');
  writeFileSync(join(root, '04_ADS', '3_已完成', '26-0508-12-review-findings-c.md'), '# C\n');

  mkdirSync(join(root, '02_DWD', 'fromGithub', 'large-topic'), { recursive: true });
  for (let i = 1; i <= 5; i += 1) {
    writeFileSync(
      join(root, '02_DWD', 'fromGithub', 'large-topic', `page-${i}.md`),
      [
        '---',
        `title: Page ${i}`,
        'confidence: medium',
        'sources: [01_ODS/fromArticle/stable-source.md]',
        '---',
        `# Page ${i}`,
      ].join('\n')
    );
  }

  return root;
}

describe('knowledge-health-core', () => {
  test('summarizes layer counts and health signals', async () => {
    const report = await analyzeKnowledgeHealth({ rootDir: makeFixture() });

    expect(report.layers.ods.files).toBe(2);
    expect(report.layers.dwd.files).toBe(7);
    expect(report.layers.dws.files).toBe(1);
    expect(report.layers.ads.byState['1_收集']).toBe(1);
    expect(report.layers.ads.byState['2_进行中']).toBe(1);
    expect(report.layers.ads.byState['3_已完成']).toBe(1);

    expect(report.odsHash.checked).toBe(2);
    expect(report.odsHash.drifted).toHaveLength(1);
    expect(report.quality.lowConfidence).toHaveLength(1);
    expect(report.quality.contested).toHaveLength(1);
    expect(report.links.orphans).toHaveLength(6);
    expect(report.schemas.missing).toHaveLength(1);
  });

  test('formats a compact markdown report', async () => {
    const report = await analyzeKnowledgeHealth({ rootDir: makeFixture() });
    const markdown = formatKnowledgeHealthReport(report);

    expect(markdown).toContain('# 知识健康检查');
    expect(markdown).toContain('ODS 原始资料');
    expect(markdown).toContain('Hash 漂移');
    expect(markdown).toContain('低置信度');
    expect(markdown).toContain('孤岛页面');
    expect(markdown).toContain('主题 Schema');
  });

  test('detects borrowed gbrain-style maintenance signals', async () => {
    const root = makeFixture();

    mkdirSync(join(root, '00_方向盘'), { recursive: true });
    writeFileSync(
      join(root, '00_方向盘', '02_当前任务.md'),
      [
        '# 当前任务',
        '',
        '## 进行中',
        '',
        '- 缺少 ADS 链接的方向盘任务',
        '',
        '## 成功标准',
        '',
        '- Jack 通过方向盘表达方向、任务和瓶颈。',
        '- Codex 能同步 ADS、DWS、DWD 和 DIM。',
        '',
        '## Codex 执行动作',
        '',
        '- 先读方向盘，再读 ADS/DWS/DWD。',
      ].join('\n')
    );
    writeFileSync(join(root, '00_方向盘', '05_下一步.md'), '# 下一步\n');

    writeFileSync(
      join(root, '03_DWS', 'topics', 'structured-topic.md'),
      [
        '---',
        'title: Structured Topic',
        'canonical_id: shared-topic',
        'aliases: [重复别名]',
        'confidence: high',
        'sources: [02_DWD/fromArticle/concept-a.md]',
        'relations:',
        '  - type: depends_on',
        '    target: 00_DIM/rules/missing-rule.md',
        '---',
        '# Structured Topic',
        '',
        '## 当前结论',
        '',
        '这里有当前结论。',
        '',
        '## 精确时间线',
        '',
        '- 2026-05-08：缺少分钟。',
        '',
        '## 原始证据',
        '',
        '- ODS 来源：`01_ODS/fromArticle/missing.md`',
      ].join('\n')
    );

    writeFileSync(
      join(root, '02_DWD', 'fromArticle', 'duplicate-alias.md'),
      [
        '---',
        'title: Duplicate Alias',
        'canonical_id: duplicate-alias',
        'aliases: [重复别名]',
        'confidence: high',
        'sources: [01_ODS/fromArticle/stable-source.md]',
        '---',
        '# Duplicate Alias',
        '',
        '## 精确时间线',
        '',
        '- 2026-05-08 12:30：有分钟。',
      ].join('\n')
    );

    writeFileSync(join(root, '04_ADS', '2_进行中', '26-0508-12-plan-task_plan-incomplete.md'), '# Incomplete\n');
    writeFileSync(join(root, '04_ADS', '3_已完成', '26-0508-12-plan-task_plan-done.md'), '# Done\n');

    const report = await analyzeKnowledgeHealth({ rootDir: root });

    expect(report.structure.missingCurrentConclusion.length).toBeGreaterThan(0);
    expect(report.structure.invalidTimeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '03_DWS/topics/structured-topic.md' }),
    ]));
    expect(report.metadata.duplicateAliases).toEqual(expect.arrayContaining([
      expect.objectContaining({ alias: '重复别名' }),
    ]));
    expect(report.metadata.brokenRelations).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: '00_DIM/rules/missing-rule.md' }),
    ]));
    expect(report.evidence.brokenRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: '01_ODS/fromArticle/missing.md' }),
    ]));
    expect(report.adsGroups.incomplete.length).toBeGreaterThan(0);
    expect(report.adsGroups.completedWithoutDws.length).toBeGreaterThan(0);
    expect(report.direction.missingAdsLinks).toHaveLength(1);
  });

  test('does not mark ADS evidence broken after state movement', async () => {
    const root = makeFixture();
    const movedName = '26-0508-12-plan-task_plan-moved.md';
    writeFileSync(
      join(root, '04_ADS', '3_已完成', movedName),
      [
        '---',
        'canonical_id: moved-task',
        'aliases: [moved-task]',
        '---',
        '# Moved Task',
        '',
        '## 当前结论',
        '',
        '任务已完成。',
        '',
        '## 精确时间线',
        '',
        '- 2026-05-08 12:30：任务从进行中移动到已完成。',
        '',
        '## 原始证据',
        '',
        `- 历史迁移来源：\`04_ADS/2_进行中/${movedName}\``,
      ].join('\n')
    );

    const report = await analyzeKnowledgeHealth({ rootDir: root });

    expect(report.evidence.brokenRefs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ target: `04_ADS/2_进行中/${movedName}` }),
    ]));
  });

  test('does not flag shared ADS task aliases inside the same three-file group', async () => {
    const root = makeFixture();
    const base = '26-0508-12-plan';
    for (const type of ['task_plan', 'findings', 'progress']) {
      writeFileSync(
        join(root, '04_ADS', '2_进行中', `${base}-${type}-same-task.md`),
        [
          '---',
          `canonical_id: same-task-${type}`,
          'aliases: [同一个ADS任务]',
          '---',
          '# Same Task',
          '',
          '## 当前结论',
          '',
          '这是同一 ADS 三件套。',
          '',
          '## 精确时间线',
          '',
          '- 2026-05-08 12:30：记录同一任务三件套。',
          '',
          '## 原始证据',
          '',
          '- 来源：`04_ADS/2_进行中/26-0508-12-plan-task_plan-same-task.md`',
        ].join('\n')
      );
    }

    const report = await analyzeKnowledgeHealth({ rootDir: root });

    expect(report.metadata.duplicateAliases).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ alias: '同一个ads任务' }),
    ]));
  });
});
