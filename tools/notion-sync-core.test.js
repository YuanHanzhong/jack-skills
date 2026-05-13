import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_DIRECTION_FILES,
  DEFAULT_CONTEXT_FILES,
  buildDefaultContextObjects,
  buildDefaultDirectionObjects,
  decideSyncAction,
  isSyncableLocalPath,
  normalizeNotionPageId,
  updateObjectAfterSync,
} from './notion-sync-core.js';

describe('notion-sync core', () => {
  test('tracks every direction wheel file by default', () => {
    const objects = buildDefaultDirectionObjects();

    expect(objects.map((object) => object.local_path)).toEqual(
      DEFAULT_DIRECTION_FILES.map((name) => `00_方向盘/${name}`),
    );
    expect(objects.every((object) => object.always === true)).toBe(true);
    expect(objects.every((object) => object.direction === 'bidirectional')).toBe(true);
  });

  test('tracks Jack context files by default for mobile Codex', () => {
    const objects = buildDefaultContextObjects();

    expect(objects.map((object) => object.local_path)).toEqual(
      DEFAULT_CONTEXT_FILES.map((item) => item.local_path),
    );
    expect(objects.every((object) => object.always === true)).toBe(true);
    expect(objects.every((object) => object.direction === 'bidirectional')).toBe(true);
  });

  test('uses Notion when only Notion changed since the base version', () => {
    expect(decideSyncAction({
      baseHash: 'local-a',
      localHash: 'local-a',
      baseNotionRevision: 'notion-a',
      notionRevision: 'notion-b',
      notionPageId: 'page-id',
    })).toBe('notion_to_local');
  });

  test('uses local markdown when only local changed since the base version', () => {
    expect(decideSyncAction({
      baseHash: 'local-a',
      localHash: 'local-b',
      baseNotionRevision: 'notion-a',
      notionRevision: 'notion-a',
      notionPageId: 'page-id',
    })).toBe('local_to_notion');
  });

  test('skips unchanged objects and queues bilateral edits as conflicts', () => {
    expect(decideSyncAction({
      baseHash: 'same',
      localHash: 'same',
      baseNotionRevision: 'rev',
      notionRevision: 'rev',
      notionPageId: 'page-id',
    })).toBe('skip');

    expect(decideSyncAction({
      baseHash: 'old-local',
      localHash: 'new-local',
      baseNotionRevision: 'old-rev',
      notionRevision: 'new-rev',
      notionPageId: 'page-id',
    })).toBe('conflict');
  });

  test('bootstraps unlinked objects by pushing local content to Notion', () => {
    expect(decideSyncAction({
      baseHash: null,
      localHash: 'local-a',
      baseNotionRevision: null,
      notionRevision: null,
      notionPageId: null,
    })).toBe('create_notion');
  });

  test('records a new common base after successful sync', () => {
    const updated = updateObjectAfterSync({
      object: {
        object_id: 'direction:00_README.md',
        local_path: '00_方向盘/00_README.md',
        notion_page_id: null,
      },
      localHash: 'hash-b',
      notionRevision: 'rev-b',
      notionPageId: '35abad10f05a81c489c3f8783ca108a4',
      syncedAt: '2026-05-08T00:00:00.000Z',
    });

    expect(updated.base_hash).toBe('hash-b');
    expect(updated.base_notion_revision).toBe('rev-b');
    expect(updated.notion_page_id).toBe('35abad10-f05a-81c4-89c3-f8783ca108a4');
    expect(updated.last_synced_at).toBe('2026-05-08T00:00:00.000Z');
  });

  test('ADS sync only allows unfinished task states', () => {
    expect(isSyncableLocalPath('04_ADS/1_收集/26-0508-13-plan-task_plan-demo.md')).toBe(true);
    expect(isSyncableLocalPath('04_ADS/2_进行中/26-0508-13-plan-task_plan-demo.md')).toBe(true);
    expect(isSyncableLocalPath('04_ADS/3_已完成/26-0508-13-plan-task_plan-demo.md')).toBe(false);
    expect(isSyncableLocalPath('03_DWS/example.md')).toBe(true);
  });
});
