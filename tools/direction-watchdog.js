#!/usr/bin/env bun

import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const DIRECTION_DIR = join(ROOT_DIR, '00_方向盘');
const STATE_DIR = join(ROOT_DIR, '.memory');
const STATE_FILE = join(STATE_DIR, 'direction-watchdog-state.json');
const args = new Set(process.argv.slice(2));

const ROUTES = [
  {
    pattern: /^00_README\.md$/,
    target: '00_方向盘/ + 00_DIM/rules/',
    action: '检查方向盘入口说明是否仍保持极简，并确认协作规则或工具命令是否需要同步。',
  },
  {
    pattern: /^01_今日总结\.md$/,
    target: '03_DWS/sessions/',
    action: '检查是否需要新增 DWS 日总结，或更新 04_最近沉淀.md 的极简摘要。',
  },
  {
    pattern: /^02_当前任务\.md$/,
    target: '04_ADS/',
    action: '检查是否需要创建、更新或移动 ADS 任务，并同步当前执行计划。',
  },
  {
    pattern: /^03_战略瓶颈\.md$/,
    target: '04_ADS/ + 00_DIM/rules/',
    action: '检查 ADS 优先级、当前任务和稳定规则是否需要调整。',
  },
  {
    pattern: /^04_最近沉淀\.md$/,
    target: '03_DWS/ + 02_DWD/',
    action: '检查是否需要补 DWS 沉淀，或把可复习判断转成 DWD 闪卡。',
  },
  {
    pattern: /^05_下一步\.md$/,
    target: '04_ADS/ + plan',
    action: '检查下一步是否需要转为可执行计划、待办或自动化任务。',
  },
  {
    pattern: /^06_日程表\.md$/,
    target: 'automation + 04_ADS/',
    action: '检查是否需要提醒、定时任务或任务排期。',
  },
];

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function extractTitle(content, fallback) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function loadPreviousState() {
  if (!existsSync(STATE_FILE)) {
    return { files: {}, lastRunAt: null };
  }

  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch (error) {
    return { files: {}, lastRunAt: null, stateReadError: error.message };
  }
}

function scanDirectionFiles() {
  if (!existsSync(DIRECTION_DIR)) {
    throw new Error(`方向盘目录不存在：${relative(ROOT_DIR, DIRECTION_DIR)}`);
  }

  const files = {};
  const names = readdirSync(DIRECTION_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort();

  for (const name of names) {
    const fullPath = join(DIRECTION_DIR, name);
    const stat = statSync(fullPath);
    const content = readFileSync(fullPath, 'utf8');

    files[name] = {
      path: relative(ROOT_DIR, fullPath).replaceAll('\\', '/'),
      title: extractTitle(content, name),
      hash: sha256(content),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      mtime: stat.mtime.toISOString(),
    };
  }

  return files;
}

function classifyChanges(previousFiles, currentFiles) {
  const added = [];
  const modified = [];
  const removed = [];

  for (const [name, file] of Object.entries(currentFiles)) {
    const previous = previousFiles[name];
    if (!previous) {
      added.push({ name, file });
    } else if (previous.hash !== file.hash) {
      modified.push({ name, file, previous });
    }
  }

  for (const [name, previous] of Object.entries(previousFiles)) {
    if (!currentFiles[name]) {
      removed.push({ name, previous });
    }
  }

  return { added, modified, removed };
}

function routeFor(name) {
  const route = ROUTES.find((item) => item.pattern.test(name));
  if (route) return route;

  return {
    target: '00_方向盘/ + manual review',
    action: '这是新的方向盘文件，先判断它是否应保留在极简入口，还是迁移到 ADS/DWS/DWD/DIM。',
  };
}

function formatChangeLine(type, change) {
  const route = routeFor(change.name);
  const file = change.file || change.previous;
  return `- ${type} \`${file.path || `00_方向盘/${change.name}`}\`：${route.action} 建议同步目标：\`${route.target}\``;
}

function printReport(previousState, currentFiles, changes) {
  const currentNames = Object.keys(currentFiles);
  const changeCount = changes.added.length + changes.modified.length + changes.removed.length;

  console.log('# 方向盘 Watchdog 报告');
  console.log('');
  console.log(`- 检查目录：\`00_方向盘/\``);
  console.log(`- 当前文件数：${currentNames.length}`);
  console.log(`- 上次检查：${previousState.lastRunAt || '无历史快照'}`);
  console.log(`- 本次变化：${changeCount}`);
  console.log('');

  if (previousState.stateReadError) {
    console.log(`⚠️ 上次快照读取失败：${previousState.stateReadError}`);
    console.log('');
  }

  if (changeCount === 0) {
    console.log('✅ 未检测到方向盘 Markdown 变化。');
    return;
  }

  console.log('## 变化明细');
  console.log('');

  changes.added.forEach((change) => console.log(formatChangeLine('新增', change)));
  changes.modified.forEach((change) => console.log(formatChangeLine('修改', change)));
  changes.removed.forEach((change) => console.log(formatChangeLine('删除', change)));
  console.log('');
  console.log('## Codex 下一步');
  console.log('');
  console.log('- 先判断这些变化是否改变当前战略瓶颈或执行优先级。');
  console.log('- 再决定是否同步 ADS 任务、DWS 沉淀、DWD 闪卡或 DIM 规则。');
  console.log('- 最后保持方向盘极简，只回写 Jack 需要看的结果。');
}

function writeCurrentState(currentFiles) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    STATE_FILE,
    `${JSON.stringify(
      {
        lastRunAt: new Date().toISOString(),
        files: currentFiles,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function main() {
  const previousState = loadPreviousState();
  const currentFiles = scanDirectionFiles();
  const changes = classifyChanges(previousState.files || {}, currentFiles);

  if (args.has('--json')) {
    console.log(JSON.stringify({ previousState, currentFiles, changes }, null, 2));
  } else {
    printReport(previousState, currentFiles, changes);
  }

  writeCurrentState(currentFiles);

  const changeCount = changes.added.length + changes.modified.length + changes.removed.length;
  if (args.has('--fail-on-change') && changeCount > 0) {
    process.exitCode = 2;
  }
}

main();
