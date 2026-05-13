#!/usr/bin/env bun

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function shanghaiMinute(now = new Date()) {
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

function shanghaiTaskStamp(now = new Date()) {
  const minute = shanghaiMinute(now);
  return `${minute.slice(2, 4)}-${minute.slice(5, 7)}${minute.slice(8, 10)}-${minute.slice(11, 13)}`;
}

function updateCheckpointFrontmatter(content, now = new Date()) {
  if (!content.startsWith('---\n')) {
    return content;
  }

  const end = content.indexOf('\n---', 4);
  if (end < 0) {
    return content;
  }

  let frontmatter = content.slice(4, end);
  const body = content.slice(end);
  const stamp = shanghaiTaskStamp(now);

  if (/^updated:\s*.+$/m.test(frontmatter)) {
    frontmatter = frontmatter.replace(/^updated:\s*.+$/m, `updated: ${stamp}`);
  } else {
    frontmatter += `\nupdated: ${stamp}`;
  }

  if (/^action_count:\s*\d+\s*$/m.test(frontmatter)) {
    frontmatter = frontmatter.replace(/^action_count:\s*(\d+)\s*$/m, (_, count) => `action_count: ${Number(count) + 1}`);
  }

  return `---\n${frontmatter}${body}`;
}

function companionName(taskName, type) {
  return taskName.replace('-task_plan-', `-${type}-`);
}

export function findAdsCompanion({ rootDir = DEFAULT_ROOT_DIR, taskPath }) {
  if (!taskPath || !taskPath.includes('-task_plan-')) {
    throw new Error('taskPath 必须指向 ADS task_plan 文件');
  }
  const relativeTaskPath = normalizePath(taskPath);
  const dir = dirname(relativeTaskPath);
  const name = basename(relativeTaskPath);
  const progressRelativePath = normalizePath(join(dir, companionName(name, 'progress')));
  const findingsRelativePath = normalizePath(join(dir, companionName(name, 'findings')));
  const progressPath = join(rootDir, progressRelativePath);
  const findingsPath = join(rootDir, findingsRelativePath);

  return {
    progressRelativePath,
    findingsRelativePath,
    progressPath,
    findingsPath,
  };
}

export function appendCheckpoint({
  rootDir = DEFAULT_ROOT_DIR,
  taskPath,
  type = 'progress',
  message,
  transcriptPath,
  sourcePath,
  extractFrom,
  now = new Date(),
}) {
  if (transcriptPath || sourcePath || extractFrom) {
    throw new Error('checkpoint 是 model-written writer，不支持从 transcript/source 自动抽取内容');
  }
  if (!message) {
    throw new Error('缺少 checkpoint message');
  }
  const companion = findAdsCompanion({ rootDir, taskPath });
  const isFinding = type === 'finding' || type === 'findings';
  const targetPath = isFinding ? companion.findingsPath : companion.progressPath;
  const targetRelativePath = isFinding ? companion.findingsRelativePath : companion.progressRelativePath;

  if (!existsSync(targetPath)) {
    throw new Error(`目标 ADS companion 不存在: ${targetRelativePath}`);
  }

  const prefix = isFinding ? '发现' : '进度';
  const content = readFileSync(targetPath, 'utf8');
  const updatedContent = updateCheckpointFrontmatter(content, now);
  writeFileSync(targetPath, `${updatedContent}\n- ${shanghaiMinute(now)}：${prefix}：${message}\n`, 'utf8');
  return {
    target: targetRelativePath,
    type: isFinding ? 'finding' : 'progress',
  };
}

function parseArgs(args) {
  const taskIndex = args.findIndex((arg) => arg === '--task');
  const typeIndex = args.findIndex((arg) => arg === '--type');
  const messageIndex = args.findIndex((arg) => arg === '--message');
  const transcriptIndex = args.findIndex((arg) => arg === '--transcript');
  const sourceIndex = args.findIndex((arg) => arg === '--source');
  const extractIndex = args.findIndex((arg) => arg === '--extract-from');
  return {
    taskPath: taskIndex >= 0 ? args[taskIndex + 1] : null,
    type: typeIndex >= 0 ? args[typeIndex + 1] : 'progress',
    message: messageIndex >= 0 ? args[messageIndex + 1] : null,
    transcriptPath: transcriptIndex >= 0 ? args[transcriptIndex + 1] : null,
    sourcePath: sourceIndex >= 0 ? args[sourceIndex + 1] : null,
    extractFrom: extractIndex >= 0 ? args[extractIndex + 1] : null,
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp() {
  console.log(`
ADS checkpoint 追加工具

使用方法:
  bun run checkpoint -- --task 04_ADS/2_进行中/xx-task_plan-demo.md --type progress --message "完成测试"
  bun run checkpoint -- --task 04_ADS/2_进行中/xx-task_plan-demo.md --type finding --message "关键发现"

边界:
  本工具是 writer，只追加大模型已经提炼好的 --message，不读取 transcript 或原始日志做内容抽取。
`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = appendCheckpoint({
    rootDir: process.cwd(),
    taskPath: options.taskPath,
    type: options.type,
    message: options.message,
    transcriptPath: options.transcriptPath,
    sourcePath: options.sourcePath,
    extractFrom: options.extractFrom,
  });
  console.log(options.json ? JSON.stringify(result, null, 2) : `✅ 已追加 checkpoint 到 ${relative(process.cwd(), join(process.cwd(), result.target))}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`❌ checkpoint 失败: ${error.message}`);
    process.exit(1);
  }
}
