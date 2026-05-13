import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { loadSyncState, registerLocalFile, runNotionSync } from './notion-sync.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-notion-sync-'));
  mkdirSync(join(root, '00_方向盘'), { recursive: true });
  mkdirSync(join(root, '02_DWD'), { recursive: true });

  for (const name of [
    '00_README.md',
    '01_今日总结.md',
    '02_当前任务.md',
    '03_战略瓶颈.md',
    '04_最近沉淀.md',
    '05_下一步.md',
    '06_日程表.md',
  ]) {
    writeFileSync(join(root, '00_方向盘', name), `# ${name}\n`, 'utf8');
  }

  writeFileSync(join(root, '02_DWD', 'example.md'), '# Example\n', 'utf8');
  return root;
}

describe('notion-sync cli support', () => {
  test('loadSyncState does not auto-track direction wheel objects', () => {
    const root = makeFixture();
    const state = loadSyncState({ rootDir: root });

    expect(state.objects).toEqual({});
  });

  test('registerLocalFile records a specific document for future bidirectional sync', () => {
    const root = makeFixture();
    const state = registerLocalFile(loadSyncState({ rootDir: root }), {
      rootDir: root,
      filePath: '02_DWD/example.md',
      title: 'Example 文档',
    });

    expect(state.objects['file:02_DWD/example.md']).toEqual(expect.objectContaining({
      local_path: '02_DWD/example.md',
      notion_title: 'Example 文档',
      direction: 'bidirectional',
    }));
  });

  test('rejects completed ADS tasks when registering sync objects', () => {
    const root = makeFixture();
    mkdirSync(join(root, '04_ADS', '3_已完成'), { recursive: true });
    writeFileSync(
      join(root, '04_ADS', '3_已完成', '26-0508-13-plan-task_plan-done.md'),
      '# Done\n',
      'utf8',
    );

    expect(() => registerLocalFile(loadSyncState({ rootDir: root }), {
      rootDir: root,
      filePath: '04_ADS/3_已完成/26-0508-13-plan-task_plan-done.md',
      title: '已完成任务',
    })).toThrow('ADS 只同步 1_收集 和 2_进行中');
  });

  test('dry run writes sync state without requiring Notion credentials', async () => {
    const root = makeFixture();
    const result = await runNotionSync({
      rootDir: root,
      apply: false,
      registerPath: '02_DWD/example.md',
      registerTitle: 'Example 文档',
    });

    expect(result.actions.some((action) => action.action === 'create_notion')).toBe(true);
    expect(existsSync(join(root, '00_DIM', 'sync', 'notion-sync-state.json'))).toBe(true);

    const saved = JSON.parse(readFileSync(join(root, '00_DIM', 'sync', 'notion-sync-state.json'), 'utf8'));
    expect(saved.notion_root_page_id).toBe('315bad10-f05a-8092-8d51-e21275eb4b84');
  });
});
