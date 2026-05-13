#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');

const DIRECTION_TASK_FILES = [
  {
    file: '02_当前任务.md',
    defaultState: '2_进行中',
    sections: {
      '收集': '1_收集',
      '待办': '1_收集',
      '下一步': '1_收集',
      '进行中': '2_进行中',
      '当前任务': '2_进行中',
      '已完成': '3_已完成',
      '完成': '3_已完成',
    },
  },
  {
    file: '05_下一步.md',
    defaultState: '1_收集',
    sections: {
      '下一步': '1_收集',
      '进行中': '2_进行中',
      '已完成': '3_已完成',
    },
  },
];

const STATE_DIRS = ['1_收集', '2_进行中', '3_已完成'];
const ADS_TYPES = ['task_plan', 'findings', 'progress'];

function rootPath(rootDir, ...parts) {
  return join(rootDir, ...parts);
}

function normalizeTitle(title) {
  return title
    .replace(/[`*_~[\]()#>]/g, '')
    .replace(/<!--.*?-->/g, '')
    .replace(/ADS：.*/g, '')
    .replace(/\s+/g, '')
    .replace(/[，。、“”‘’：:；;！!？?（）()《》<>【】\[\]、/\\|]/g, '')
    .trim();
}

function fileSafeTitle(title) {
  const safe = normalizeTitle(title).replace(/[^\p{Script=Han}\p{Letter}\p{Number}-]/gu, '');
  return safe.slice(0, 48) || '方向盘任务';
}

function displayTitle(raw) {
  return raw
    .replace(/^\s*(?:[-*+]\s+|\d+\.\s+|\[[ xX✓]\]\s*)/, '')
    .replace(/\s*<!--\s*ads:[^>]+-->\s*/g, '')
    .trim();
}

function timestampParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = String(values.year).slice(-2);
  const month = values.month;
  const day = values.day;
  const hour = values.hour;
  return {
    yyMMddHH: `${year}-${month}${day}-${hour}`,
    iso: now.toISOString(),
  };
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

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function headingText(line) {
  const match = line.match(/^#{2,6}\s+(.+?)\s*$/);
  return match ? match[1].trim() : null;
}

function stateForSection(config, section) {
  if (!section) return config.defaultState;

  for (const [keyword, state] of Object.entries(config.sections)) {
    if (section.includes(keyword)) return state;
  }

  return null;
}

function extractBullet(lines, index) {
  const line = lines[index];
  const bullet = line.match(/^(\s*)(?:[-*+]\s+|\d+\.\s+)(.+)$/);
  if (!bullet) return null;
  if (bullet[1].length > 0) return null;

  const title = displayTitle(bullet[2]);
  if (!title || title.startsWith('ADS：')) return null;

  let adsPath = null;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const next = lines[cursor];
    if (/^\S/.test(next) && /^(?:[-*+]\s+|\d+\.\s+|#{1,6}\s+)/.test(next)) break;

    const linkMatch = next.match(/ADS：`([^`]+)`/);
    if (linkMatch) {
      adsPath = linkMatch[1];
      break;
    }
  }

  return { title, lineIndex: index, adsPath };
}

export function extractDirectionTasks({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const tasks = [];
  const directionDir = rootPath(rootDir, '00_方向盘');

  for (const config of DIRECTION_TASK_FILES) {
    const filePath = join(directionDir, config.file);
    const content = readIfExists(filePath);
    if (!content) continue;

    const lines = content.split('\n');
    let section = null;

    lines.forEach((line, index) => {
      const heading = headingText(line);
      if (heading) {
        section = heading;
        return;
      }

      const bullet = extractBullet(lines, index);
      if (!bullet) return;

      tasks.push({
        title: bullet.title,
        key: normalizeTitle(bullet.title),
        sourceFile: `00_方向盘/${config.file}`,
        sourceName: config.file,
        lineIndex: index,
        targetState: stateForSection(config, section),
        adsPath: bullet.adsPath,
      });
    });
  }

  const seen = new Set();
  return tasks.filter((task) => task.targetState).filter((task) => {
    const key = `${task.sourceFile}:${task.key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseAdsFileName(name) {
  const match = name.match(/^(\d{2}-\d{4}-\d{2})-(chat|learn|plan|exec|review)-(task_plan|findings|progress)-(.+)\.md$/);
  if (!match) return null;
  return {
    prefix: match[1],
    mode: match[2],
    type: match[3],
    titlePart: match[4],
    key: normalizeTitle(match[4]),
  };
}

function metadataKeys(filePath) {
  try {
    const parsed = matter(readFileSync(filePath, 'utf8'));
    return [
      parsed.data.canonical_id,
      parsed.data.canonicalId,
      ...(Array.isArray(parsed.data.aliases) ? parsed.data.aliases : []),
    ]
      .filter(Boolean)
      .map((value) => normalizeTitle(String(value)))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function listAdsFiles(rootDir) {
  const files = [];
  const adsDir = rootPath(rootDir, '04_ADS');

  for (const state of STATE_DIRS) {
    const stateDir = join(adsDir, state);
    if (!existsSync(stateDir)) continue;

    for (const name of readdirSync(stateDir)) {
      if (!name.endsWith('.md') || name === 'README.md') continue;
      const parsed = parseAdsFileName(name);
      if (!parsed) continue;
      files.push({
        ...parsed,
        searchKeys: [parsed.key, ...metadataKeys(join(stateDir, name))],
        name,
        state,
        path: `04_ADS/${state}/${name}`,
        fullPath: join(stateDir, name),
      });
    }
  }

  return files;
}

function groupForTask(task, adsFiles) {
  if (task.adsPath) {
    const normalizedPath = task.adsPath.replaceAll('\\', '/');
    const direct = adsFiles.find((file) => file.path === normalizedPath);
    if (direct) {
      return adsFiles.filter((file) => (
        file.prefix === direct.prefix &&
        file.mode === direct.mode &&
        file.titlePart === direct.titlePart
      ));
    }
  }

  const byTitle = adsFiles.find((file) => file.key === task.key);
  const byMetadata = adsFiles.find((file) => file.searchKeys.includes(task.key));
  const matched = byTitle || byMetadata;
  if (!matched) return [];

  return adsFiles.filter((file) => (
    file.prefix === matched.prefix &&
    file.mode === matched.mode &&
    file.titlePart === matched.titlePart
  ));
}

export function analyzeDirectionSync({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const tasks = extractDirectionTasks({ rootDir });
  const adsFiles = listAdsFiles(rootDir);
  const actions = [];

  for (const task of tasks) {
    const group = groupForTask(task, adsFiles);
    if (group.length === 0) {
      actions.push({
        type: 'create',
        title: task.title,
        key: task.key,
        sourceFile: task.sourceFile,
        sourceName: task.sourceName,
        lineIndex: task.lineIndex,
        targetState: task.targetState,
      });
      continue;
    }

    const taskPlan = group.find((file) => file.type === 'task_plan') || group[0];
    if (taskPlan.state !== task.targetState) {
      actions.push({
        type: 'move',
        title: task.title,
        key: task.key,
        sourceFile: task.sourceFile,
        sourceName: task.sourceName,
        lineIndex: task.lineIndex,
        targetState: task.targetState,
        fromState: taskPlan.state,
        taskPlanPath: taskPlan.path,
        files: group.map((file) => file.path),
      });
      continue;
    }

    if (!task.adsPath) {
      actions.push({
        type: 'link',
        title: task.title,
        key: task.key,
        sourceFile: task.sourceFile,
        sourceName: task.sourceName,
        lineIndex: task.lineIndex,
        targetState: task.targetState,
        taskPlanPath: taskPlan.path,
      });
    }
  }

  return { tasks, actions };
}

function ensureAdsDirs(rootDir) {
  for (const state of STATE_DIRS) {
    mkdirSync(rootPath(rootDir, '04_ADS', state), { recursive: true });
  }
}

function createAdsContent({ type, title, sourceFile, state, now }) {
  const { yyMMddHH, iso } = timestampParts(now);
  const status = state === '3_已完成' ? 'completed' : state === '2_进行中' ? 'in_progress' : 'todo';

  if (type === 'task_plan') {
    return [
      '---',
      '层级: ADS',
      '类型: task_plan',
      `created: ${yyMMddHH}`,
      `updated: ${yyMMddHH}`,
      `status: ${status}`,
      `canonical_id: ${fileSafeTitle(title)}`,
      `aliases: ["${title.replaceAll('"', '\\"')}"]`,
      'relations:',
      `  - type: driven_by`,
      `    target: ${sourceFile}`,
      'tags: ["方向盘同步", "ADS流转"]',
      `source: ${sourceFile}`,
      '---',
      '',
      `# 🎯 ${title}`,
      '',
      '## 结论',
      '',
      `本任务由方向盘 Markdown 自动同步进入 ADS，当前状态为 \`${state}\`。`,
      '',
      '## 当前结论',
      '',
      `方向盘已要求处理：${title}`,
      '',
      '## 精确时间线',
      '',
      `- ${formatShanghaiMinute(now)}：由方向盘同步器创建 ADS 任务组。`,
      '',
      '## 关联内容',
      '',
      `- 驱动来源：\`${sourceFile}\``,
      '',
      '## 原始证据',
      '',
      `- 方向盘条目：\`${sourceFile}\``,
      '',
      '## 来源方向盘',
      '',
      `- 来源：\`${sourceFile}\``,
      `- 同步时间：${iso}`,
      '',
      '## 任务定义',
      '',
      `- 任务：${title}`,
      '- 目标：按方向盘指令维护执行层，确保任务状态在 ADS 三态中可追踪。',
      '',
      '## 执行计划',
      '',
      '- [ ] 明确任务目标和验收标准',
      '- [ ] 执行必要的文档、规则或代码更新',
      '- [ ] 更新 progress 和 findings',
      '- [ ] 完成后移动到 `04_ADS/3_已完成/`',
      '',
    ].join('\n');
  }

  if (type === 'findings') {
    return [
      '---',
      '层级: ADS',
      '类型: findings',
      `created: ${yyMMddHH}`,
      `updated: ${yyMMddHH}`,
      `status: ${status}`,
      `canonical_id: ${fileSafeTitle(title)}-findings`,
      `aliases: ["${title.replaceAll('"', '\\"')}"]`,
      'relations:',
      `  - type: supports`,
      `    target: ${sourceFile}`,
      'tags: ["方向盘同步", "发现记录"]',
      `source: ${sourceFile}`,
      '---',
      '',
      `# 🔍 发现与决策：${title}`,
      '',
      '## 结论',
      '',
      '本文件记录执行过程中的关键发现、取舍和后续可复用判断。',
      '',
      '## 当前结论',
      '',
      '- 待执行过程中补充。',
      '',
      '## 精确时间线',
      '',
      `- ${formatShanghaiMinute(now)}：由方向盘同步器创建 findings 文件。`,
      '',
      '## 关联内容',
      '',
      `- 驱动来源：\`${sourceFile}\``,
      '',
      '## 原始证据',
      '',
      `- 方向盘条目：\`${sourceFile}\``,
      '',
      '## 来源方向盘',
      '',
      `- 来源：\`${sourceFile}\``,
      `- 同步时间：${iso}`,
      '',
      '## 发现记录',
      '',
      '- 待补充。',
      '',
    ].join('\n');
  }

  return [
    '---',
    '层级: ADS',
    '类型: progress',
    `created: ${yyMMddHH}`,
    `updated: ${yyMMddHH}`,
    `status: ${status}`,
    `canonical_id: ${fileSafeTitle(title)}-progress`,
    `aliases: ["${title.replaceAll('"', '\\"')}"]`,
    'relations:',
    `  - type: tracks`,
    `    target: ${sourceFile}`,
    'tags: ["方向盘同步", "进度记录"]',
    `source: ${sourceFile}`,
    '---',
    '',
    `# 📊 进度日志：${title}`,
    '',
    '## 当前结论',
    '',
    `本任务当前处于 \`${state}\`，来源于方向盘指令。`,
    '',
    '## 精确时间线',
    '',
    `- ${formatShanghaiMinute(now)}：由方向盘自动同步创建 ADS 任务组。`,
    '',
    '## 关联内容',
    '',
    `- 驱动来源：\`${sourceFile}\``,
    '',
    '## 原始证据',
    '',
    `- 方向盘条目：\`${sourceFile}\``,
    '',
    '## 当前状态',
    '',
    `- ADS 状态：\`${state}\``,
    `- 来源方向盘：\`${sourceFile}\``,
    `- 首次同步：${iso}`,
    '',
    '## 进度记录',
    '',
    `- ${iso}：由方向盘自动同步创建 ADS 任务组。`,
    '',
  ].join('\n');
}

function createAdsGroup(rootDir, action, now) {
  const { yyMMddHH } = timestampParts(now);
  const safeTitle = fileSafeTitle(action.title);
  const stateDir = rootPath(rootDir, '04_ADS', action.targetState);
  const created = [];

  mkdirSync(stateDir, { recursive: true });

  for (const type of ADS_TYPES) {
    const fileName = `${yyMMddHH}-plan-${type}-${safeTitle}.md`;
    const relativePath = `04_ADS/${action.targetState}/${fileName}`;
    writeFileSync(
      rootPath(rootDir, relativePath),
      createAdsContent({
        type,
        title: action.title,
        sourceFile: action.sourceFile,
        state: action.targetState,
        now,
      }),
      'utf8',
    );
    created.push(relativePath);
  }

  return {
    ...action,
    files: created,
    taskPlanPath: created.find((path) => path.includes('task_plan')),
  };
}

function moveAdsGroup(rootDir, action) {
  const moved = [];

  for (const relativePath of action.files) {
    const name = relativePath.split('/').pop();
    const targetPath = `04_ADS/${action.targetState}/${name}`;
    mkdirSync(rootPath(rootDir, '04_ADS', action.targetState), { recursive: true });
    renameSync(rootPath(rootDir, relativePath), rootPath(rootDir, targetPath));
    moved.push(targetPath);
  }

  return {
    ...action,
    files: moved,
    taskPlanPath: moved.find((path) => path.includes('task_plan')) || moved[0],
  };
}

function replaceAdsLineForSource(rootDir, sourceName, lineIndex, taskPlanPath) {
  const filePath = rootPath(rootDir, '00_方向盘', sourceName);
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const linkLine = `  - ADS：\`${taskPlanPath}\``;

  for (let cursor = lineIndex + 1; cursor < lines.length; cursor += 1) {
    const next = lines[cursor];
    if (/^\s+-\s+ADS：`/.test(next)) {
      lines[cursor] = linkLine;
      writeFileSync(filePath, lines.join('\n'), 'utf8');
      return;
    }
    if (/^\S/.test(next) && /^(?:[-*+]\s+|\d+\.\s+|#{1,6}\s+)/.test(next)) break;
  }

  lines.splice(lineIndex + 1, 0, linkLine);
  writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function updateDirectionLinks(rootDir, appliedActions) {
  const actionable = appliedActions.filter((action) => action.taskPlanPath);
  const bySource = new Map();

  for (const action of actionable) {
    if (!bySource.has(action.sourceName)) bySource.set(action.sourceName, []);
    bySource.get(action.sourceName).push(action);
  }

  for (const actions of bySource.values()) {
    actions
      .sort((a, b) => b.lineIndex - a.lineIndex)
      .forEach((action) => {
        replaceAdsLineForSource(rootDir, action.sourceName, action.lineIndex, action.taskPlanPath);
      });
  }
}

function refreshIndex(rootDir) {
  const result = spawnSync('bun', ['run', 'index'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return {
      ok: false,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return { ok: true, stdout: result.stdout, stderr: result.stderr };
}

export function applyDirectionSync({
  rootDir = DEFAULT_ROOT_DIR,
  now = new Date(),
  updateIndex = true,
} = {}) {
  ensureAdsDirs(rootDir);
  const plan = analyzeDirectionSync({ rootDir });
  const applied = [];

  for (const action of plan.actions) {
    if (action.type === 'create') {
      applied.push(createAdsGroup(rootDir, action, now));
    } else if (action.type === 'move') {
      applied.push(moveAdsGroup(rootDir, action));
    } else if (action.type === 'link') {
      applied.push(action);
    }
  }

  updateDirectionLinks(rootDir, applied);

  const index = updateIndex ? refreshIndex(rootDir) : { ok: true, skipped: true };
  return { ...plan, applied, index };
}

function formatAction(action) {
  if (action.type === 'create') {
    return `- 创建 ADS 任务组：${action.title} → ${action.targetState}`;
  }
  if (action.type === 'move') {
    return `- 移动 ADS 任务组：${action.title}，${action.fromState} → ${action.targetState}`;
  }
  return `- 回写 ADS 链接：${action.title} → ${action.taskPlanPath}`;
}

function printPlan(plan, applied = null) {
  console.log('# 方向盘 ADS 同步报告');
  console.log('');
  console.log(`- 识别任务：${plan.tasks.length}`);
  console.log(`- 待执行动作：${plan.actions.length}`);
  console.log('');

  if (plan.actions.length === 0) {
    console.log('✅ 方向盘与 ADS 已对齐。');
    return;
  }

  console.log('## 动作明细');
  console.log('');
  plan.actions.forEach((action) => console.log(formatAction(action)));

  if (applied) {
    console.log('');
    console.log('## 已执行');
    console.log('');
    applied.forEach((action) => console.log(formatAction(action)));
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const shouldApply = args.has('--apply');
  const noIndex = args.has('--no-index');

  if (shouldApply) {
    const result = applyDirectionSync({ updateIndex: !noIndex });
    printPlan(result, result.applied);

    if (!result.index.ok) {
      console.error('⚠️ ADS 索引刷新失败：');
      console.error(result.index.stderr || result.index.stdout);
      process.exitCode = 1;
    }
    return;
  }

  const plan = analyzeDirectionSync();
  printPlan(plan);
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : null;
if (entryPath && relative(process.argv[1], entryPath) === '') {
  main();
}
