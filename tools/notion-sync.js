#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

import {
  decideSyncAction,
  isSyncableLocalPath,
  mergeTrackedObjects,
  normalizeNotionPageId,
  sha256,
  updateObjectAfterSync,
} from './notion-sync-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');
const DEFAULT_STATE_PATH = '00_DIM/sync/notion-sync-state.json';
const DEFAULT_NOTION_ROOT_PAGE_ID = '315bad10-f05a-8092-8d51-e21275eb4b84';
const NOTION_VERSION = '2022-06-28';

function rootPath(rootDir, ...parts) {
  return join(rootDir, ...parts);
}

function nowIso() {
  return new Date().toISOString();
}

function emptyState() {
  return {
    version: 1,
    notion_root_page_id: DEFAULT_NOTION_ROOT_PAGE_ID,
    updated_at: null,
    objects: {},
    conflicts: [],
    reports: [],
  };
}

export function loadSyncState({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const statePath = rootPath(rootDir, DEFAULT_STATE_PATH);
  const state = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, 'utf8'))
    : emptyState();

  return {
    ...emptyState(),
    ...state,
    notion_root_page_id: normalizeNotionPageId(
      state.notion_root_page_id || state.mobile_codex_page_id || DEFAULT_NOTION_ROOT_PAGE_ID,
    ),
    objects: mergeTrackedObjects(state.objects || {}),
    conflicts: Array.isArray(state.conflicts) ? state.conflicts : [],
    reports: Array.isArray(state.reports) ? state.reports : [],
  };
}

export function saveSyncState(state, { rootDir = DEFAULT_ROOT_DIR } = {}) {
  const statePath = rootPath(rootDir, DEFAULT_STATE_PATH);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify({ ...state, updated_at: nowIso() }, null, 2)}\n`,
    'utf8',
  );
}

function normalizeLocalPath(rootDir, inputPath) {
  const normalized = inputPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.startsWith('/')) return relative(rootDir, normalized).replace(/\\/g, '/');
  return normalized;
}

export function registerLocalFile(state, { rootDir = DEFAULT_ROOT_DIR, filePath, title }) {
  const localPath = normalizeLocalPath(rootDir, filePath);
  if (!isSyncableLocalPath(localPath)) {
    throw new Error(`该路径不允许同步：${localPath}。ADS 只同步 1_收集 和 2_进行中，跳过 3_已完成。`);
  }
  const objectId = `file:${localPath}`;

  return {
    ...state,
    objects: {
      ...state.objects,
      [objectId]: {
        object_id: objectId,
        local_path: localPath,
        notion_page_id: state.objects[objectId]?.notion_page_id || null,
        notion_title: title || state.objects[objectId]?.notion_title || localPath.split('/').pop(),
        direction: 'bidirectional',
        always: false,
        base_hash: state.objects[objectId]?.base_hash || null,
        base_notion_revision: state.objects[objectId]?.base_notion_revision || null,
        last_synced_at: state.objects[objectId]?.last_synced_at || null,
        last_local_hash: state.objects[objectId]?.last_local_hash || null,
        last_notion_revision: state.objects[objectId]?.last_notion_revision || null,
        conflict_policy: 'queue',
      },
    },
  };
}

function getNotionToken() {
  return process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || process.env.NOTION_KEY || null;
}

async function notionRequest(path, { method = 'GET', body = null, token = getNotionToken() } = {}) {
  if (!token) {
    throw new Error('缺少 Notion token：请设置 NOTION_TOKEN 或 NOTION_API_KEY。');
  }

  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Notion API ${method} ${path} failed: ${response.status} ${text}`);
  }

  return response.json();
}

function richText(content) {
  return [{ type: 'text', text: { content: String(content).slice(0, 2000) } }];
}

function markdownToBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split('\n');
  let inCode = false;
  let codeBuffer = [];

  function flushCode() {
    if (codeBuffer.length === 0) return;
    blocks.push({
      object: 'block',
      type: 'code',
      code: {
        language: 'markdown',
        rich_text: richText(codeBuffer.join('\n').slice(0, 2000)),
      },
    });
    codeBuffer = [];
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    if (/^###\s+/.test(line)) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: richText(line.replace(/^###\s+/, '')) } });
    } else if (/^##\s+/.test(line)) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: richText(line.replace(/^##\s+/, '')) } });
    } else if (/^#\s+/.test(line)) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: richText(line.replace(/^#\s+/, '')) } });
    } else if (/^\s*[-*]\s+/.test(line)) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(line.replace(/^\s*[-*]\s+/, '')) } });
    } else if (/^\s*\d+\.\s+/.test(line)) {
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(line.replace(/^\s*\d+\.\s+/, '')) } });
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: line ? richText(line) : [] } });
    }
  }

  flushCode();
  return blocks.slice(0, 100);
}

function blockText(block) {
  const payload = block[block.type];
  return (payload?.rich_text || []).map((item) => item.plain_text || item.text?.content || '').join('');
}

function blocksToMarkdown(blocks) {
  return blocks.map((block) => {
    const text = blockText(block);
    if (block.type === 'heading_1') return `# ${text}`;
    if (block.type === 'heading_2') return `## ${text}`;
    if (block.type === 'heading_3') return `### ${text}`;
    if (block.type === 'bulleted_list_item') return `- ${text}`;
    if (block.type === 'numbered_list_item') return `1. ${text}`;
    if (block.type === 'code') return `\`\`\`markdown\n${text}\n\`\`\``;
    return text;
  }).join('\n');
}

async function fetchAllChildren(blockId) {
  const results = [];
  let cursor = null;

  do {
    const suffix = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : '';
    const page = await notionRequest(`/blocks/${blockId}/children${suffix}`);
    results.push(...(page.results || []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);

  return results;
}

async function fetchNotionSnapshot(pageId) {
  if (!pageId) return { revision: null, markdown: null };
  const page = await notionRequest(`/pages/${normalizeNotionPageId(pageId)}`);
  const children = await fetchAllChildren(page.id);
  return {
    revision: page.last_edited_time,
    markdown: blocksToMarkdown(children),
  };
}

async function replacePageContent(pageId, markdown) {
  const children = await fetchAllChildren(pageId);
  for (const child of children) {
    await notionRequest(`/blocks/${child.id}`, {
      method: 'PATCH',
      body: { archived: true },
    });
  }

  const blocks = markdownToBlocks(markdown);
  if (blocks.length > 0) {
    await notionRequest(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: { children: blocks },
    });
  }

  const page = await notionRequest(`/pages/${normalizeNotionPageId(pageId)}`);
  return page.last_edited_time;
}

async function createChildPage(parentPageId, title, markdown) {
  const page = await notionRequest('/pages', {
    method: 'POST',
    body: {
      parent: { page_id: normalizeNotionPageId(parentPageId) },
      properties: {
        title: {
          title: richText(title),
        },
      },
      children: markdownToBlocks(markdown),
    },
  });

  return {
    pageId: page.id,
    revision: page.last_edited_time,
  };
}

function appendConflict(state, { object, localHash, notionRevision }) {
  const existing = state.conflicts.some((conflict) => (
    conflict.object_id === object.object_id &&
    conflict.local_hash === localHash &&
    conflict.notion_revision === notionRevision &&
    conflict.status === 'open'
  ));

  if (existing) return state;

  return {
    ...state,
    conflicts: [
      ...state.conflicts,
      {
        id: `conflict:${Date.now()}:${object.object_id}`,
        object_id: object.object_id,
        local_path: object.local_path,
        notion_page_id: object.notion_page_id,
        local_hash: localHash,
        notion_revision: notionRevision,
        base_hash: object.base_hash,
        base_notion_revision: object.base_notion_revision,
        status: 'open',
        created_at: nowIso(),
        policy: 'manual_merge',
      },
    ],
  };
}

export async function runNotionSync({
  rootDir = DEFAULT_ROOT_DIR,
  apply = false,
  registerPath = null,
  registerTitle = null,
} = {}) {
  let state = loadSyncState({ rootDir });

  if (registerPath) {
    state = registerLocalFile(state, { rootDir, filePath: registerPath, title: registerTitle });
  }

  const actions = [];

  for (const object of Object.values(state.objects)) {
    if (!isSyncableLocalPath(object.local_path)) {
      actions.push({ object_id: object.object_id, local_path: object.local_path, action: 'skip_completed_ads' });
      continue;
    }

    const localFile = rootPath(rootDir, object.local_path);
    if (!existsSync(localFile)) {
      actions.push({ object_id: object.object_id, local_path: object.local_path, action: 'missing_local' });
      continue;
    }

    const localContent = readFileSync(localFile, 'utf8');
    const localHash = sha256(localContent);
    const notion = apply && object.notion_page_id
      ? await fetchNotionSnapshot(object.notion_page_id)
      : { revision: object.base_notion_revision, markdown: null };
    const action = decideSyncAction({
      baseHash: object.base_hash,
      localHash,
      baseNotionRevision: object.base_notion_revision,
      notionRevision: notion.revision,
      notionPageId: object.notion_page_id,
    });

    actions.push({
      object_id: object.object_id,
      local_path: object.local_path,
      notion_page_id: object.notion_page_id,
      action,
    });

    if (!apply) continue;

    if (action === 'create_notion') {
      const created = await createChildPage(
        state.notion_root_page_id,
        object.notion_title || object.local_path,
        localContent,
      );
      state.objects[object.object_id] = updateObjectAfterSync({
        object,
        localHash,
        notionRevision: created.revision,
        notionPageId: created.pageId,
      });
    } else if (action === 'local_to_notion') {
      const revision = await replacePageContent(object.notion_page_id, localContent);
      state.objects[object.object_id] = updateObjectAfterSync({
        object,
        localHash,
        notionRevision: revision,
      });
    } else if (action === 'notion_to_local') {
      writeFileSync(localFile, notion.markdown, 'utf8');
      const updatedHash = sha256(notion.markdown);
      state.objects[object.object_id] = updateObjectAfterSync({
        object,
        localHash: updatedHash,
        notionRevision: notion.revision,
      });
    } else if (action === 'conflict') {
      state = appendConflict(state, { object, localHash, notionRevision: notion.revision });
    }
  }

  state.reports = [
    ...state.reports.slice(-19),
    {
      at: nowIso(),
      apply,
      actions,
    },
  ];
  saveSyncState(state, { rootDir });

  return { state, actions };
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function printReport(actions) {
  console.log('# Notion 移动端 Codex 同步报告');
  console.log('');
  for (const action of actions) {
    console.log(`- ${action.action}: ${action.local_path}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply') || args.includes('--once');
  const registerPath = getArgValue(args, '--register');
  const registerTitle = getArgValue(args, '--title');

  try {
    const result = await runNotionSync({ apply, registerPath, registerTitle });
    printReport(result.actions);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : null;
if (entryPath && relative(process.argv[1], entryPath) === '') {
  await main();
}
