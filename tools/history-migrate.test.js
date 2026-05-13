import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { migrateHistory } from './history-migrate.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-history-migrate-'));
  mkdirSync(join(root, '01_ODS'), { recursive: true });
  mkdirSync(join(root, '02_DWD', 'fromArticle'), { recursive: true });
  mkdirSync(join(root, '03_DWS', 'sessions', '系统管理'), { recursive: true });
  mkdirSync(join(root, '04_ADS', '2_进行中'), { recursive: true });
  mkdirSync(join(root, '04_ADS', '3_已完成'), { recursive: true });

  writeFileSync(join(root, '01_ODS', 'raw.md'), '# Raw\n不要修改\n');
  writeFileSync(
    join(root, '02_DWD', 'fromArticle', 'legacy-topic.md'),
    [
      '---',
      'title: Legacy Topic',
      '---',
      '# Legacy Topic',
      '',
      '历史内容。',
    ].join('\n')
  );
  writeFileSync(
    join(root, '03_DWS', 'sessions', '系统管理', '26-0508-12-旧会话.md'),
    '# 旧会话\n\n历史会话内容。\n'
  );
  writeFileSync(
    join(root, '04_ADS', '2_进行中', '26-0508-12-plan-task_plan-demo.md'),
    '# Demo\n\n已有 task_plan。\n'
  );
  writeFileSync(
    join(root, '04_ADS', '3_已完成', '26-0508-12-exec-findings-done.md'),
    '# Done\n\n已有 findings。\n'
  );

  return root;
}

describe('history-migrate', () => {
  test('adds gbrain-style structure to historical DWD/DWS/ADS without touching ODS', async () => {
    const root = makeFixture();
    const result = await migrateHistory({
      rootDir: root,
      now: new Date('2026-05-08T14:30:00+08:00'),
      apply: true,
      updateIndex: false,
    });

    expect(result.updatedPages.length).toBeGreaterThan(0);
    expect(readFileSync(join(root, '01_ODS', 'raw.md'), 'utf8')).toBe('# Raw\n不要修改\n');

    const migrated = readFileSync(join(root, '02_DWD', 'fromArticle', 'legacy-topic.md'), 'utf8');
    expect(migrated).toContain('canonical_id: legacy-topic');
    expect(migrated).toContain('## 当前结论');
    expect(migrated).toContain('- 2026-05-08 14:30：批量历史迁移');
    expect(migrated).toContain('## 原始证据');
  });

  test('creates missing ADS files for incomplete historical groups', async () => {
    const root = makeFixture();
    const result = await migrateHistory({
      rootDir: root,
      now: new Date('2026-05-08T14:30:00+08:00'),
      apply: true,
      updateIndex: false,
    });

    expect(result.createdAdsFiles).toEqual(expect.arrayContaining([
      expect.stringContaining('04_ADS/2_进行中/26-0508-12-plan-findings-demo.md'),
      expect.stringContaining('04_ADS/2_进行中/26-0508-12-plan-progress-demo.md'),
      expect.stringContaining('04_ADS/3_已完成/26-0508-12-exec-task_plan-done.md'),
      expect.stringContaining('04_ADS/3_已完成/26-0508-12-exec-progress-done.md'),
    ]));
    expect(existsSync(join(root, '04_ADS', '2_进行中', '26-0508-12-plan-findings-demo.md'))).toBe(true);
  });

  test('sanitizes broken emoji surrogate escapes from migrated frontmatter and summary', async () => {
    const root = makeFixture();
    const file = join(root, '03_DWS', 'sessions', '系统管理', '26-0508-12-旧会话.md');
    writeFileSync(
      file,
      [
        '---',
        'aliases:',
        '  - "\\uDCAC 旧会话"',
        'canonical_id: old-session',
        'relations: []',
        '---',
        '# 💬 旧会话',
        '',
        '## 当前结论',
        '',
        '历史页面《� 旧会话》已补齐双层页面结构。',
        '',
        '## 精确时间线',
        '',
        '- 2026-05-08 14:30：已有记录。',
      ].join('\n')
    );

    await migrateHistory({
      rootDir: root,
      now: new Date('2026-05-08T14:30:00+08:00'),
      apply: true,
      updateIndex: false,
    });

    const migrated = readFileSync(file, 'utf8');
    expect(migrated).not.toContain('\\uDCAC');
    expect(migrated).not.toContain('�');
    expect(migrated).toContain('- 旧会话');
  });
});
