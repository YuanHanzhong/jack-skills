import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  formatStateMaintenanceReport,
  runStateMaintenance,
  summarizeKnowledgeHealth,
} from './state-maintenance.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-state-maintenance-'));

  [
    '00_方向盘',
    '00_DIM/rules',
    '01_ODS/fromWeb',
    '02_DWD/fromWeb',
    '03_DWS/topics',
    '04_ADS/1_收集',
    '04_ADS/2_进行中',
    '04_ADS/3_已完成',
    'tools',
  ].forEach((dir) => mkdirSync(join(root, dir), { recursive: true }));

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        type: 'module',
        scripts: {
          'direction:sync': 'bun run tools/direction-sync.js',
          'knowledge:health': 'bun run tools/knowledge-health.js',
          check: 'bun run tools/naming-checker.js',
        },
      },
      null,
      2
    )
  );

  writeFileSync(
    join(root, '00_方向盘', '02_当前任务.md'),
    [
      '# 当前任务',
      '',
      '## 进行中',
      '',
      '- 建立方向盘 Watchdog，让 Codex 定期检查 Jack 修改过的 Markdown 指令。',
      '',
      '## 成功标准',
      '',
      '- Jack 只看战略目的，不看任务长清单。',
    ].join('\n')
  );
  writeFileSync(join(root, '00_方向盘', '05_下一步.md'), '# 下一步\n');

  writeFileSync(join(root, '01_ODS/fromWeb/source.md'), '# Source\n');
  writeFileSync(
    join(root, '02_DWD/fromWeb/topic.md'),
    [
      '---',
      'title: Topic',
      'confidence: high',
      'sources: [01_ODS/fromWeb/source.md]',
      '---',
      '# Topic',
      '',
      '## 当前结论',
      '',
      '结论。',
      '',
      '## 精确时间线',
      '',
      '- 2026-05-08 12:30：记录。',
    ].join('\n')
  );
  writeFileSync(join(root, '03_DWS/topics/README.md'), '# Topics\n');

  return root;
}

describe('state-maintenance', () => {
  test('summarizes health into compact strategic counters', async () => {
    const result = await runStateMaintenance({ rootDir: makeFixture(), apply: false, runNamingCheck: false });

    expect(result.direction.actions).toHaveLength(1);
    expect(result.catalog.commands).toBeGreaterThan(0);
    expect(result.health.summary.odsMissingSha256).toBe(1);
    expect(result.health.summary.directionMissingAdsLinks).toBe(1);
  });

  test('dry run does not write catalog or ADS files', async () => {
    const root = makeFixture();
    await runStateMaintenance({ rootDir: root, apply: false, runNamingCheck: false });

    expect(existsSync(join(root, '00_DIM', 'TOOL_CATALOG.md'))).toBe(false);
    expect(readFileSync(join(root, '00_方向盘', '02_当前任务.md'), 'utf8')).not.toContain('ADS：`');
  });

  test('apply writes catalog and synchronizes direction ADS state', async () => {
    const root = makeFixture();
    const result = await runStateMaintenance({
      rootDir: root,
      apply: true,
      runIndex: false,
      runNamingCheck: false,
      now: new Date('2026-05-08T12:34:00+08:00'),
    });

    expect(result.direction.applied.some((item) => item.type === 'create')).toBe(true);
    expect(existsSync(join(root, '00_DIM', 'TOOL_CATALOG.md'))).toBe(true);
    expect(readFileSync(join(root, '00_方向盘', '02_当前任务.md'), 'utf8')).toContain('ADS：`');
  });

  test('report uses strategic progress format instead of task dump', async () => {
    const result = await runStateMaintenance({ rootDir: makeFixture(), apply: false, runNamingCheck: false });
    const report = formatStateMaintenanceReport(result);

    expect(report).toContain('## 战略目的');
    expect(report).toContain('## 战略瓶颈');
    expect(report).toContain('## 长期方向进展');
    expect(report).toContain('任务只作为证据');
  });

  test('reports ADS state review candidates without moving files in dry run', async () => {
    const root = makeFixture();
    writeFileSync(
      join(root, '04_ADS', '2_进行中', '26-0509-02-exec-task_plan-done.md'),
      [
        '---',
        '层级: ADS',
        '类型: task_plan',
        'status: in_progress',
        '---',
        '# done',
        '',
        '- [x] 完成实现。',
        '- [x] 完成验证。',
      ].join('\n'),
    );
    writeFileSync(
      join(root, '04_ADS', '2_进行中', '26-0509-02-exec-progress-done.md'),
      [
        '---',
        '层级: ADS',
        '类型: progress',
        'status: in_progress',
        '---',
        '# done progress',
        '',
        '最终验证：bun test tools/demo.test.js 3 pass/0 fail。',
      ].join('\n'),
    );
    writeFileSync(
      join(root, '04_ADS', '2_进行中', '26-0509-02-exec-findings-done.md'),
      [
        '---',
        '层级: ADS',
        '类型: findings',
        'status: in_progress',
        '---',
        '# done findings',
      ].join('\n'),
    );

    const result = await runStateMaintenance({ rootDir: root, apply: false, runNamingCheck: false });
    const report = formatStateMaintenanceReport(result);

    expect(result.adsStateReview.candidates).toHaveLength(1);
    expect(report).toContain('ADS 状态复核');
    expect(existsSync(join(root, '04_ADS', '2_进行中', '26-0509-02-exec-task_plan-done.md'))).toBe(true);
  });

  test('health summary keeps noisy details out of the default report', () => {
    const summary = summarizeKnowledgeHealth({
      odsHash: { missing: [{ path: 'a' }], drifted: [] },
      quality: { missingConfidence: [], missingSources: [{ path: 'b' }], lowConfidence: [], contested: [] },
      links: { orphans: [{ path: 'c' }], broken: [] },
      adsGroups: { incomplete: [], completedWithoutDws: [] },
      direction: { missingAdsLinks: [] },
      metadata: { brokenRelations: [] },
      evidence: { brokenRefs: [] },
    });

    expect(summary.totalDebt).toBe(3);
  });
});
