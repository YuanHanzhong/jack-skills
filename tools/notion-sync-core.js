import { createHash } from 'crypto';

export const DEFAULT_DIRECTION_FILES = [
  '00_README.md',
  '01_今日总结.md',
  '02_当前任务.md',
  '03_战略瓶颈.md',
  '04_最近沉淀.md',
  '05_下一步.md',
  '06_日程表.md',
];

export const DEFAULT_CONTEXT_FILES = [
  {
    object_id: 'context:project-memory',
    local_path: '00_DIM/memory.md',
    notion_title: '默认同步 - 项目记忆与协作偏好',
  },
  {
    object_id: 'context:jack-personality-vector',
    local_path: '03_DWS/知识图谱/Jack人格向量.md',
    notion_title: '默认同步 - Jack 人格向量',
  },
  {
    object_id: 'context:preference-localization',
    local_path: '00_DIM/rules/偏好本地化规范.md',
    notion_title: '默认同步 - 偏好本地化规范',
  },
  {
    object_id: 'context:value-conflict-task',
    local_path: '04_ADS/2_进行中/26-0226-21-plan-task_plan-价值观矛盾澄清.md',
    notion_title: '默认同步 - 价值观矛盾澄清长期任务',
  },
  {
    object_id: 'context:value-conflict-session-1',
    local_path: '03_DWS/sessions/个人成长/26-0227-11-价值观矛盾澄清.md',
    notion_title: '默认同步 - 价值观矛盾澄清会话 1',
  },
  {
    object_id: 'context:value-conflict-session-2',
    local_path: '03_DWS/sessions/个人成长/26-0227-13-价值观矛盾续-矛盾2具体化.md',
    notion_title: '默认同步 - 价值观矛盾澄清会话 2',
  },
];

export function normalizeNotionPageId(value) {
  if (!value) return null;
  const compact = String(value).trim().replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(compact)) return String(value).trim();
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join('-').toLowerCase();
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function buildDefaultDirectionObjects() {
  return DEFAULT_DIRECTION_FILES.map((name) => ({
    object_id: `direction:${name}`,
    local_path: `00_方向盘/${name}`,
    notion_page_id: null,
    notion_title: `方向盘 - ${name}`,
    direction: 'bidirectional',
    always: true,
    base_hash: null,
    base_notion_revision: null,
    last_synced_at: null,
    last_local_hash: null,
    last_notion_revision: null,
    conflict_policy: 'queue',
  }));
}

export function buildDefaultContextObjects() {
  return DEFAULT_CONTEXT_FILES.map((item) => ({
    object_id: item.object_id,
    local_path: item.local_path,
    notion_page_id: null,
    notion_title: item.notion_title,
    direction: 'bidirectional',
    always: true,
    base_hash: null,
    base_notion_revision: null,
    last_synced_at: null,
    last_local_hash: null,
    last_notion_revision: null,
    conflict_policy: 'queue',
  }));
}

export function decideSyncAction({
  baseHash,
  localHash,
  baseNotionRevision,
  notionRevision,
  notionPageId,
}) {
  if (!notionPageId) return 'create_notion';
  if (!baseHash || !baseNotionRevision) return 'local_to_notion';

  const localChanged = localHash !== baseHash;
  const notionChanged = notionRevision !== baseNotionRevision;

  if (!localChanged && notionChanged) return 'notion_to_local';
  if (localChanged && !notionChanged) return 'local_to_notion';
  if (!localChanged && !notionChanged) return 'skip';
  return 'conflict';
}

export function updateObjectAfterSync({
  object,
  localHash,
  notionRevision,
  notionPageId,
  syncedAt = new Date().toISOString(),
}) {
  return {
    ...object,
    notion_page_id: normalizeNotionPageId(notionPageId || object.notion_page_id),
    base_hash: localHash,
    base_notion_revision: notionRevision,
    last_local_hash: localHash,
    last_notion_revision: notionRevision,
    last_synced_at: syncedAt,
  };
}

export function mergeTrackedObjects(existingObjects = {}) {
  return { ...existingObjects };
}

export function isSyncableLocalPath(localPath) {
  const normalized = String(localPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized.startsWith('04_ADS/')) return true;

  return (
    normalized.startsWith('04_ADS/1_收集/') ||
    normalized.startsWith('04_ADS/2_进行中/')
  );
}
