#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');
const STRUCTURED_DIRS = ['02_DWD', '03_DWS', '04_ADS'];
const ADS_STATES = ['1_收集', '2_进行中', '3_已完成'];
const ADS_TYPES = ['task_plan', 'findings', 'progress'];

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function rel(rootDir, path) {
  return normalizePath(relative(rootDir, path));
}

function safeSlug(value) {
  const raw = String(value || '')
    .replace(/\.md$/i, '')
    .replace(/^(?:\d{2}-\d{4}-\d{2}-)?(?:chat|learn|plan|exec|review-)?(?:task_plan|findings|progress)-/g, '')
    .trim();
  const ascii = raw
    .normalize('NFKD')
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return ascii.slice(0, 64) || 'historical-page';
}

function sanitizeBrokenUnicode(value) {
  return String(value || '')
    .replace(/\\uD[0-9A-Fa-f]{3}/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/^[\s️]+|[\s️]+$/g, '')
    .trim();
}

function sanitizeDeep(value) {
  if (typeof value === 'string') return sanitizeBrokenUnicode(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep).filter((item) => item !== '');
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeDeep(item)]),
    );
  }
  return value;
}

function formatShanghaiMinute(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function titleFor(filePath, parsed) {
  if (parsed.data.title) return sanitizeBrokenUnicode(parsed.data.title);
  if (parsed.data['任务名称']) return sanitizeBrokenUnicode(parsed.data['任务名称']);
  const heading = parsed.content.match(/^#\s+(.+)$/m);
  return heading ? sanitizeBrokenUnicode(heading[1].replace(/^\p{Emoji_Presentation}\s*/u, '')) : basename(filePath, '.md');
}

async function structuredFiles(rootDir) {
  const files = [];
  for (const dir of STRUCTURED_DIRS) {
    const base = join(rootDir, dir);
    if (!existsSync(base)) continue;
    files.push(...await glob(join(base, '**', '*.md'), {
      ignore: ['**/INDEX.md', '**/README.md', '**/node_modules/**'],
      windowsPathsNoEscape: true,
    }));
  }
  return files.sort();
}

function addMetadata(data, filePath, parsed) {
  const next = sanitizeDeep({ ...data });
  const title = titleFor(filePath, parsed);

  if (!next.canonical_id && !next.canonicalId) {
    next.canonical_id = safeSlug(basename(filePath, '.md'));
  }

  const aliases = Array.isArray(next.aliases) ? next.aliases.map(sanitizeBrokenUnicode).filter(Boolean) : [];
  if (!aliases.includes(title)) {
    next.aliases = [title, ...aliases].filter(Boolean);
  }

  if (!next.relations) {
    next.relations = [];
  }

  return next;
}

function insertionIndexAfterH1(content) {
  const lines = content.split('\n');
  const index = lines.findIndex((line) => /^#\s+/.test(line));
  return index === -1 ? 0 : index + 1;
}

function insertSection(content, heading, body, afterHeading = null) {
  if (new RegExp(`^##\\s+${heading}\\s*$`, 'm').test(content)) return content;

  const block = ['', `## ${heading}`, '', body.trim(), ''].join('\n');
  const lines = content.split('\n');

  if (afterHeading) {
    const afterIndex = lines.findIndex((line) => new RegExp(`^##\\s+${afterHeading}\\s*$`).test(line));
    if (afterIndex !== -1) {
      let insertAt = lines.length;
      for (let index = afterIndex + 1; index < lines.length; index += 1) {
        if (/^##\s+/.test(lines[index])) {
          insertAt = index;
          break;
        }
      }
      lines.splice(insertAt, 0, block);
      return lines.join('\n');
    }
  }

  const insertAt = insertionIndexAfterH1(content);
  lines.splice(insertAt, 0, block);
  return lines.join('\n');
}

function migrateContent(filePath, parsed, now) {
  const relativePath = normalizePath(filePath);
  const minute = formatShanghaiMinute(now);
  const title = titleFor(filePath, parsed);
  let content = sanitizeBrokenUnicode(parsed.content);

  content = insertSection(
    content,
    '原始证据',
    [
      `- 历史迁移来源：\`${relativePath}\``,
      '- 说明：本页为既有历史文档，批量迁移只补结构，不改写原始判断。',
    ].join('\n'),
  );
  content = insertSection(
    content,
    '关联内容',
    [
      '- 关联任务：待补充',
      '- 关联规则：待补充',
    ].join('\n'),
  );
  content = insertSection(
    content,
    '精确时间线',
    `- ${minute}：批量历史迁移，补充双层页面结构、canonical_id、aliases 和原始证据区块。`,
  );
  content = insertSection(
    content,
    '当前结论',
    `历史页面《${title}》已补齐双层页面结构；具体结论仍以原文主体内容为准，后续复盘时再提炼为更短的当前结论。`,
  );

  return content;
}

function writeMigratedPage(rootDir, filePath, now, apply) {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = matter(raw);
  const nextData = addMetadata(parsed.data || {}, filePath, parsed);
  const nextContent = migrateContent(rel(rootDir, filePath), { ...parsed, data: nextData }, now);
  const nextRaw = matter.stringify(nextContent.trimStart(), nextData);

  if (nextRaw === raw) return null;
  if (apply) writeFileSync(filePath, nextRaw, 'utf8');
  return rel(rootDir, filePath);
}

function parseAdsName(name) {
  const match = name.match(/^(\d{2}-\d{4}-\d{2})-(chat|learn|plan|exec|review)-(task_plan|findings|progress)-(.+)\.md$/);
  if (!match) return null;
  return {
    prefix: match[1],
    mode: match[2],
    type: match[3],
    title: match[4],
    groupKey: `${match[1]}-${match[2]}-${match[4]}`,
  };
}

function adsGroups(rootDir) {
  const groups = new Map();
  const adsRoot = join(rootDir, '04_ADS');

  for (const state of ADS_STATES) {
    const stateDir = join(adsRoot, state);
    if (!existsSync(stateDir)) continue;
    for (const name of readdirSync(stateDir)) {
      const parsed = parseAdsName(name);
      if (!parsed) continue;
      const current = groups.get(parsed.groupKey) || {
        ...parsed,
        state,
        files: new Map(),
      };
      current.files.set(parsed.type, join(stateDir, name));
      groups.set(parsed.groupKey, current);
    }
  }

  return [...groups.values()];
}

function adsContent({ type, title, state, now, sourcePath }) {
  const minute = formatShanghaiMinute(now);
  const status = state === '3_已完成' ? 'completed' : state === '2_进行中' ? 'in_progress' : 'todo';
  const heading = type === 'task_plan' ? '🎯' : type === 'findings' ? '🔍 发现与决策：' : '📊 进度日志：';

  return matter.stringify(
    [
      `# ${heading}${type === 'task_plan' ? ' ' : ''}${title}`,
      '',
      '## 当前结论',
      '',
      `本文件为历史 ADS 三件套补全文档，状态为 \`${state}\`，具体内容需后续按原任务补充。`,
      '',
      '## 精确时间线',
      '',
      `- ${minute}：批量补齐历史 ADS 三件套，来源文件：\`${sourcePath}\`。`,
      '',
      '## 关联内容',
      '',
      `- 同组来源：\`${sourcePath}\``,
      '',
      '## 原始证据',
      '',
      `- 历史 ADS 来源：\`${sourcePath}\``,
      '',
      type === 'task_plan' ? '## 执行计划' : type === 'findings' ? '## 发现记录' : '## 进度记录',
      '',
      '- 待补充。',
      '',
    ].join('\n'),
    {
      '层级': 'ADS',
      '类型': type,
      status,
      canonical_id: safeSlug(`${title}-${type}`),
      aliases: [title],
      relations: [{ type: 'derived_from', target: sourcePath }],
      tags: ['历史迁移', 'ADS三件套'],
    },
  );
}

function completeAdsGroups(rootDir, now, apply) {
  const created = [];

  for (const group of adsGroups(rootDir)) {
    const sourcePath = rel(rootDir, group.files.values().next().value);
    for (const type of ADS_TYPES) {
      if (group.files.has(type)) continue;
      const fileName = `${group.prefix}-${group.mode}-${type}-${group.title}.md`;
      const fullPath = join(rootDir, '04_ADS', group.state, fileName);
      const relativePath = rel(rootDir, fullPath);
      if (apply) {
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, adsContent({ type, title: group.title, state: group.state, now, sourcePath }), 'utf8');
      }
      created.push(relativePath);
    }
  }

  return created;
}

function refreshIndex(rootDir) {
  const result = spawnSync('bun', ['run', 'index'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

export async function migrateHistory({
  rootDir = DEFAULT_ROOT_DIR,
  now = new Date(),
  apply = false,
  updateIndex = true,
} = {}) {
  const updatedPages = [];
  for (const file of await structuredFiles(rootDir)) {
    const updated = writeMigratedPage(rootDir, file, now, apply);
    if (updated) updatedPages.push(updated);
  }

  const createdAdsFiles = completeAdsGroups(rootDir, now, apply);
  const index = apply && updateIndex ? refreshIndex(rootDir) : { ok: true, skipped: true };

  return { apply, updatedPages, createdAdsFiles, index };
}

function printReport(result) {
  console.log('# 历史文档迁移报告');
  console.log('');
  console.log(`- 模式：${result.apply ? 'apply' : 'dry-run'}`);
  console.log(`- 更新历史页面：${result.updatedPages.length}`);
  console.log(`- 补齐 ADS 文件：${result.createdAdsFiles.length}`);
  console.log('');
  if (result.updatedPages.length > 0) {
    console.log('## 更新页面');
    result.updatedPages.slice(0, 40).forEach((path) => console.log(`- ${path}`));
    if (result.updatedPages.length > 40) console.log(`- ...另 ${result.updatedPages.length - 40} 个`);
    console.log('');
  }
  if (result.createdAdsFiles.length > 0) {
    console.log('## 新增 ADS 文件');
    result.createdAdsFiles.forEach((path) => console.log(`- ${path}`));
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const result = await migrateHistory({ apply: args.has('--apply') });
  printReport(result);
  if (!result.index.ok) {
    console.error(result.index.stderr || result.index.stdout);
    process.exitCode = 1;
  }
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('tools/history-migrate.js')) {
  main().catch((error) => {
    console.error(`❌ 历史文档迁移失败：${error.message}`);
    process.exit(1);
  });
}
