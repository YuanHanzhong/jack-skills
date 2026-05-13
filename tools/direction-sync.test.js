import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { analyzeDirectionSync, applyDirectionSync } from './direction-sync.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-direction-sync-'));

  mkdirSync(join(root, '00_方向盘'), { recursive: true });
  mkdirSync(join(root, '04_ADS', '1_收集'), { recursive: true });
  mkdirSync(join(root, '04_ADS', '2_进行中'), { recursive: true });
  mkdirSync(join(root, '04_ADS', '3_已完成'), { recursive: true });

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
      '- Jack 能用方向盘驱动 ADS。',
    ].join('\n'),
  );

  writeFileSync(
    join(root, '00_方向盘', '05_下一步.md'),
    [
      '# 下一步',
      '',
      '1. 用一次真实任务验证方向盘变化能否驱动 ADS 任务更新。',
    ].join('\n'),
  );

  return root;
}

describe('direction-sync', () => {
  test('plans ADS creates from direction wheel markdown without writing files', () => {
    const root = makeFixture();
    const plan = analyzeDirectionSync({ rootDir: root });

    expect(plan.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'create',
        targetState: '2_进行中',
        title: '建立方向盘 Watchdog，让 Codex 定期检查 Jack 修改过的 Markdown 指令。',
      }),
      expect.objectContaining({
        type: 'create',
        targetState: '1_收集',
        title: '用一次真实任务验证方向盘变化能否驱动 ADS 任务更新。',
      }),
    ]));
    expect(readdirSync(join(root, '04_ADS', '2_进行中'))).toEqual([]);
  });

  test('apply creates ADS three-file group and writes ADS trace back to direction markdown', () => {
    const root = makeFixture();
    const result = applyDirectionSync({
      rootDir: root,
      now: new Date('2026-05-08T12:34:00+08:00'),
      updateIndex: false,
    });

    expect(result.applied.some((item) => item.type === 'create')).toBe(true);

    const doingFiles = readdirSync(join(root, '04_ADS', '2_进行中')).sort();
    expect(doingFiles).toEqual([
      '26-0508-12-plan-findings-建立方向盘Watchdog让Codex定期检查Jack修改过的Markdown指令.md',
      '26-0508-12-plan-progress-建立方向盘Watchdog让Codex定期检查Jack修改过的Markdown指令.md',
      '26-0508-12-plan-task_plan-建立方向盘Watchdog让Codex定期检查Jack修改过的Markdown指令.md',
    ]);

    const taskPlanPath = join(root, '04_ADS', '2_进行中', doingFiles.find((name) => name.includes('task_plan')));
    expect(readFileSync(taskPlanPath, 'utf8')).toContain('来源方向盘');
    expect(readFileSync(taskPlanPath, 'utf8')).toContain('02_当前任务.md');

    const directionContent = readFileSync(join(root, '00_方向盘', '02_当前任务.md'), 'utf8');
    expect(directionContent).toContain('ADS：`04_ADS/2_进行中/');
    expect(directionContent).toContain('task_plan');
  });

  test('moves an existing ADS group when direction status changes', () => {
    const root = makeFixture();
    const first = applyDirectionSync({
      rootDir: root,
      now: new Date('2026-05-08T12:34:00+08:00'),
      updateIndex: false,
    });
    const created = first.applied.find((item) => item.type === 'create' && item.title.startsWith('建立方向盘'));
    expect(created).toBeTruthy();

    writeFileSync(
      join(root, '00_方向盘', '02_当前任务.md'),
      [
        '# 当前任务',
        '',
        '## 已完成',
        '',
        '- 建立方向盘 Watchdog，让 Codex 定期检查 Jack 修改过的 Markdown 指令。',
        `  - ADS：\`${created.taskPlanPath}\``,
      ].join('\n'),
    );

    const second = applyDirectionSync({
      rootDir: root,
      now: new Date('2026-05-08T13:00:00+08:00'),
      updateIndex: false,
    });

    expect(second.applied).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'move',
        targetState: '3_已完成',
      }),
    ]));
    expect(existsSync(join(root, '04_ADS', '3_已完成', created.taskPlanPath.split('/').pop()))).toBe(true);
  });

  test('matches existing ADS task by alias before creating duplicates', () => {
    const root = makeFixture();
    const stateDir = join(root, '04_ADS', '2_进行中');

    writeFileSync(
      join(stateDir, '26-0508-12-plan-task_plan-direction-sync.md'),
      [
        '---',
        'canonical_id: direction-sync',
        'aliases:',
        '  - 建立方向盘 Watchdog，让 Codex 定期检查 Jack 修改过的 Markdown 指令。',
        '---',
        '# Existing Alias Task',
      ].join('\n')
    );
    writeFileSync(join(stateDir, '26-0508-12-plan-findings-direction-sync.md'), '# Findings\n');
    writeFileSync(join(stateDir, '26-0508-12-plan-progress-direction-sync.md'), '# Progress\n');

    const plan = analyzeDirectionSync({ rootDir: root });

    expect(plan.actions.some((action) => (
      action.type === 'create' &&
      action.title === '建立方向盘 Watchdog，让 Codex 定期检查 Jack 修改过的 Markdown 指令。'
    ))).toBe(false);
    expect(plan.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'link',
        taskPlanPath: '04_ADS/2_进行中/26-0508-12-plan-task_plan-direction-sync.md',
      }),
    ]));
  });
});
