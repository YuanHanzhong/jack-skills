import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { appendCheckpoint, findAdsCompanion } from './checkpoint.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-checkpoint-'));
  mkdirSync(join(root, '04_ADS', '2_进行中'), { recursive: true });
  const base = '26-0508-14-plan';
  const title = 'demo';
  writeFileSync(join(root, '04_ADS', '2_进行中', `${base}-task_plan-${title}.md`), '# Task\n');
  writeFileSync(join(root, '04_ADS', '2_进行中', `${base}-progress-${title}.md`), '# Progress\n\n## 进度记录\n');
  writeFileSync(join(root, '04_ADS', '2_进行中', `${base}-findings-${title}.md`), '# Findings\n\n## 发现记录\n');
  return {
    root,
    task: `04_ADS/2_进行中/${base}-task_plan-${title}.md`,
    progress: join(root, '04_ADS', '2_进行中', `${base}-progress-${title}.md`),
    findings: join(root, '04_ADS', '2_进行中', `${base}-findings-${title}.md`),
  };
}

describe('checkpoint', () => {
  test('finds progress and findings companion files', () => {
    const { root, task } = makeFixture();
    const companion = findAdsCompanion({ rootDir: root, taskPath: task });

    expect(companion.progressPath).toContain('progress-demo.md');
    expect(companion.findingsPath).toContain('findings-demo.md');
  });

  test('appends progress checkpoint events', () => {
    const { root, task, progress } = makeFixture();
    const result = appendCheckpoint({
      rootDir: root,
      taskPath: task,
      type: 'progress',
      message: '完成规则 manifest',
      now: new Date('2026-05-08T06:00:00.000Z'),
    });

    expect(result.target).toContain('progress-demo.md');
    expect(readFileSync(progress, 'utf8')).toContain('完成规则 manifest');
    expect(readFileSync(progress, 'utf8')).toContain('2026-05-08 14:00');
  });

  test('updates frontmatter action count and timestamp without changing checkpoint meaning', () => {
    const { root, task, progress } = makeFixture();
    writeFileSync(
      progress,
      [
        '---',
        'updated: 26-0508-13',
        'action_count: 1',
        '---',
        '',
        '# Progress',
        '',
      ].join('\n')
    );

    appendCheckpoint({
      rootDir: root,
      taskPath: task,
      type: 'progress',
      message: '模型已经提炼好的断点内容',
      now: new Date('2026-05-08T06:00:00.000Z'),
    });

    const content = readFileSync(progress, 'utf8');
    expect(content).toContain('updated: 26-0508-14');
    expect(content).toContain('action_count: 2');
    expect(content).toContain('模型已经提炼好的断点内容');
  });

  test('appends finding checkpoint events', () => {
    const { root, task, findings } = makeFixture();
    appendCheckpoint({
      rootDir: root,
      taskPath: task,
      type: 'finding',
      message: '规则适合按四层分类',
      now: new Date('2026-05-08T06:00:00.000Z'),
    });

    expect(readFileSync(findings, 'utf8')).toContain('规则适合按四层分类');
  });

  test('rejects transcript extraction because checkpoint is a model-written writer', () => {
    const { root, task } = makeFixture();

    expect(() => appendCheckpoint({
      rootDir: root,
      taskPath: task,
      type: 'progress',
      message: '从 transcript 自动抽取',
      transcriptPath: 'transcript.jsonl',
    })).toThrow(/writer/);
  });
});
