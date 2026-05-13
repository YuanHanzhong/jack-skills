import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  analyzeAdsStateReview,
  applyAdsStateReview,
  parseModelReview,
} from './ads-state-review.js';

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'kms-ads-state-review-'));
  ['04_ADS/1_收集', '04_ADS/2_进行中', '04_ADS/3_已完成'].forEach((dir) => {
    mkdirSync(join(root, dir), { recursive: true });
  });
  return root;
}

function writeGroup(root, title, { taskPlanBody, progressBody = '进度。', findingsBody = '发现。' } = {}) {
  const base = `26-0509-02-exec`;
  const dir = join(root, '04_ADS', '2_进行中');
  const frontmatter = (type) => [
    '---',
    '层级: ADS',
    `类型: ${type}`,
    'created: 26-0509-02',
    'updated: 26-0509-02',
    'status: in_progress',
    '---',
    '',
  ].join('\n');

  const files = {};
  for (const [type, body] of Object.entries({
    task_plan: taskPlanBody,
    findings: findingsBody,
    progress: progressBody,
  })) {
    const name = `${base}-${type}-${title}.md`;
    files[type] = `04_ADS/2_进行中/${name}`;
    writeFileSync(join(dir, name), `${frontmatter(type)}# ${title}\n\n${body}\n`, 'utf8');
  }
  return files;
}

function markCompleted(root, files) {
  for (const relativePath of Object.values(files)) {
    const path = join(root, relativePath);
    const content = readFileSync(path, 'utf8');
    writeFileSync(
      path,
      content.replace(
        'status: in_progress',
        [
          'status: in_progress',
          'completion_status: completed',
          'completion_confidence: high',
          'completion_evidence: 本轮已验证，代码可按标记移动到已完成。',
        ].join('\n'),
      ),
      'utf8',
    );
  }
}

describe('ads-state-review', () => {
  test('flags an in-progress ADS group when completed checklist and final validation are present', () => {
    const root = makeRoot();
    const files = writeGroup(root, '已完成任务', {
      taskPlanBody: [
        '## 执行计划',
        '',
        '- [x] 完成实现。',
        '- [x] 完成验证。',
        '',
        '## 验收',
        '',
        '- 已完成交付。',
      ].join('\n'),
      progressBody: '最终验证：bun test tools/demo.test.js 3 pass/0 fail；bun run check --layer=ADS 通过。',
    });

    const result = analyzeAdsStateReview({ rootDir: root });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].taskPlanPath).toBe(files.task_plan);
    expect(result.candidates[0].suggestedState).toBe('3_已完成');
  });

  test('does not flag a group when open work appears after validation evidence', () => {
    const root = makeRoot();
    writeGroup(root, '仍需继续任务', {
      taskPlanBody: [
        '- [x] 完成第一步。',
        '- [ ] 继续补齐规则。',
      ].join('\n'),
      progressBody: '最终验证：第一步已通过。\n下一步应继续补齐规则。',
    });

    const result = analyzeAdsStateReview({ rootDir: root });

    expect(result.candidates).toEqual([]);
  });

  test('flags an archive-ready group even when only future expansion remains', () => {
    const root = makeRoot();
    const files = writeGroup(root, '可归档任务', {
      taskPlanBody: [
        '## 计划',
        '',
        '- [x] 完成实现。',
        '- [x] 完成验证。',
      ].join('\n'),
      progressBody: [
        '验证结果：bun run check-hooks 通过；bun run rules:health 通过。',
        '任务状态：本任务可以归档到 `3_已完成/`，剩余只是后续是否扩展更多命令。',
      ].join('\n'),
    });

    const result = analyzeAdsStateReview({ rootDir: root });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].taskPlanPath).toBe(files.task_plan);
    expect(result.candidates[0].reason).toContain('可以归档');
  });

  test('flags a group from explicit completion markers instead of guessing from prose', () => {
    const root = makeRoot();
    const files = writeGroup(root, '显式标记任务', {
      taskPlanBody: '本文件没有完成关键词，只依赖结构化完成度标记。',
      progressBody: '记录上下文。',
    });
    markCompleted(root, files);

    const result = analyzeAdsStateReview({ rootDir: root });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].reason).toContain('completion_status');
    expect(result.candidates[0].completionMarkers).toHaveLength(3);
  });

  test('does not override explicit in-progress markers with prose heuristics', () => {
    const root = makeRoot();
    const files = writeGroup(root, '仍在推进标记任务', {
      taskPlanBody: '- [x] 完成实现。\n- [x] 完成验证。',
      progressBody: '最终验证：bun test 1 pass/0 fail。\n后续还要继续作为主线维护。',
    });
    for (const relativePath of Object.values(files)) {
      const path = join(root, relativePath);
      writeFileSync(
        path,
        readFileSync(path, 'utf8').replace('status: in_progress', 'status: in_progress\ncompletion_status: in_progress'),
        'utf8',
      );
    }

    const result = analyzeAdsStateReview({ rootDir: root });

    expect(result.candidates).toEqual([]);
  });

  test('parses model review from markdown json fence', () => {
    const review = parseModelReview([
      '# ADS 状态复核总结',
      '',
      '```json',
      '{"decisions":[{"taskPlanPath":"04_ADS/2_进行中/demo.md","targetState":"3_已完成","summary":"已经完成交付与验证。","reason":"所有验收项都有验证证据。"}]}',
      '```',
    ].join('\n'));

    expect(review.decisions[0].targetState).toBe('3_已完成');
  });

  test('apply requires model-authored review, appends summary, updates status, and moves the whole group', () => {
    const root = makeRoot();
    const files = writeGroup(root, '已完成任务', {
      taskPlanBody: '- [x] 完成实现。\n- [x] 完成验证。',
      progressBody: '最终验证：bun test tools/demo.test.js 3 pass/0 fail。',
    });
    const reviewPath = join(root, 'review.md');
    writeFileSync(
      reviewPath,
      [
        '# ADS 状态复核总结',
        '',
        '```json',
        JSON.stringify({
          decisions: [
            {
              taskPlanPath: files.task_plan,
              targetState: '3_已完成',
              summary: '该任务的实现、验证和归档条件已经满足，进行中目录不再反映真实状态。',
              reason: 'task_plan 中所有验收 checklist 已完成，progress 中有最终验证通过记录。',
            },
          ],
        }),
        '```',
      ].join('\n'),
      'utf8',
    );

    const result = applyAdsStateReview({
      rootDir: root,
      reviewFile: reviewPath,
      updateIndex: false,
      now: new Date('2026-05-09T02:40:00+08:00'),
    });

    expect(result.moved).toHaveLength(1);
    for (const source of Object.values(files)) {
      const completedPath = source.replace('04_ADS/2_进行中/', '04_ADS/3_已完成/');
      expect(existsSync(join(root, completedPath))).toBe(true);
      expect(readFileSync(join(root, completedPath), 'utf8')).toContain('status: completed');
    }
    expect(readFileSync(join(root, files.progress.replace('2_进行中', '3_已完成')), 'utf8')).toContain('## 归档总结');
  });

  test('apply moves the matching direction-wheel bullet to the completed section', () => {
    const root = makeRoot();
    mkdirSync(join(root, '00_方向盘'), { recursive: true });
    const files = writeGroup(root, '方向盘同步任务', {
      taskPlanBody: '- [x] 完成实现。\n- [x] 完成验证。',
      progressBody: '最终验证：bun test tools/demo.test.js 3 pass/0 fail。',
    });
    writeFileSync(
      join(root, '00_方向盘', '02_当前任务.md'),
      [
        '# 当前任务',
        '',
        '## 进行中',
        '',
        '- 方向盘同步任务。',
        `  - ADS：\`${files.task_plan}\``,
        '',
        '## 已完成',
        '',
      ].join('\n'),
      'utf8',
    );
    const reviewPath = join(root, 'review.md');
    writeFileSync(
      reviewPath,
      JSON.stringify({
        decisions: [
          {
            taskPlanPath: files.task_plan,
            targetState: '3_已完成',
            summary: '该任务已经完成实现和验证，应从方向盘进行中迁移到已完成。',
            reason: '任务三件套全部存在，progress 记录了最终验证通过。',
          },
        ],
      }),
      'utf8',
    );

    const result = applyAdsStateReview({
      rootDir: root,
      reviewFile: reviewPath,
      updateIndex: false,
      now: new Date('2026-05-09T02:40:00+08:00'),
    });

    const direction = readFileSync(join(root, '00_方向盘', '02_当前任务.md'), 'utf8');
    const completedSection = direction.split('## 已完成')[1];
    expect(result.moved[0].directionUpdated).toBe(true);
    expect(completedSection).toContain('- 方向盘同步任务。');
    expect(completedSection).toContain('04_ADS/3_已完成/');
  });
});
