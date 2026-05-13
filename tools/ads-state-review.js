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
import { parseArgs } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');

const ADS_STATES = ['1_收集', '2_进行中', '3_已完成'];
const ADS_TYPES = ['task_plan', 'findings', 'progress'];
const TARGET_STATUS = {
  '1_收集': 'todo',
  '2_进行中': 'in_progress',
  '3_已完成': 'completed',
};
const TARGET_COMPLETION_STATUS = {
  '1_收集': 'todo',
  '2_进行中': 'in_progress',
  '3_已完成': 'completed',
};

const NEW_ADS_PATTERN = /^(\d{2}-\d{4}-\d{2})-(chat|learn|plan|exec|review)-(task_plan|findings|progress)-(.+)\.md$/;
const OLD_ADS_PATTERN = /^(\d{2}-\d{4}-\d{2})-(task_plan|findings|progress)-(.+)\.md$/;

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function rootPath(rootDir, ...parts) {
  return join(rootDir, ...parts);
}

function parseAdsFileName(name) {
  const modern = name.match(NEW_ADS_PATTERN);
  if (modern) {
    return {
      timestamp: modern[1],
      mode: modern[2],
      type: modern[3],
      title: modern[4],
      groupKey: `${modern[1]}-${modern[2]}-${modern[4]}`,
    };
  }

  const legacy = name.match(OLD_ADS_PATTERN);
  if (legacy) {
    return {
      timestamp: legacy[1],
      mode: null,
      type: legacy[2],
      title: legacy[3],
      groupKey: `${legacy[1]}-${legacy[3]}`,
    };
  }

  return null;
}

function listAdsGroups(rootDir) {
  const groups = new Map();

  for (const state of ADS_STATES) {
    const stateDir = rootPath(rootDir, '04_ADS', state);
    if (!existsSync(stateDir)) continue;

    for (const name of readdirSync(stateDir)) {
      if (!name.endsWith('.md') || name === 'README.md' || name === 'INDEX.md') continue;

      const parsed = parseAdsFileName(name);
      if (!parsed) continue;

      const groupId = `${state}/${parsed.groupKey}`;
      const relativePath = normalizePath(join('04_ADS', state, name));
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          key: parsed.groupKey,
          timestamp: parsed.timestamp,
          mode: parsed.mode,
          title: parsed.title,
          state,
          files: {},
        });
      }

      groups.get(groupId).files[parsed.type] = {
        type: parsed.type,
        name,
        path: relativePath,
        fullPath: rootPath(rootDir, relativePath),
      };
    }
  }

  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function readGroupText(group) {
  return ADS_TYPES.map((type) => {
    const file = group.files[type];
    if (!file) return '';
    return readFileSync(file.fullPath, 'utf8');
  }).join('\n\n');
}

function readFrontmatter(content) {
  if (!content.startsWith('---\n')) return {};
  const end = content.indexOf('\n---', 4);
  if (end === -1) return {};

  const frontmatter = {};
  for (const line of content.slice(4, end).split('\n')) {
    const match = line.match(/^([^:#][^:]*):\s*(.*)$/);
    if (!match) continue;
    frontmatter[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return frontmatter;
}

function readGroupCompletionMarkers(group) {
  return ADS_TYPES
    .map((type) => {
      const file = group.files[type];
      if (!file) return null;
      const frontmatter = readFrontmatter(readFileSync(file.fullPath, 'utf8'));
      const value = frontmatter.completion_status || frontmatter['完成度状态'] || frontmatter['完成状态'] || '';
      const confidence = frontmatter.completion_confidence || frontmatter['完成度置信度'] || '';
      const evidence = frontmatter.completion_evidence || frontmatter['完成度证据'] || '';
      return {
        type,
        path: file.path,
        value: String(value).toLowerCase(),
        rawValue: value,
        confidence,
        evidence,
      };
    })
    .filter(Boolean);
}

function matchIndexes(text, regex) {
  return [...text.matchAll(regex)].map((match) => match.index ?? 0);
}

function lineIndexes(text, regex, { ignore = () => false } = {}) {
  const indexes = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    if (regex.test(line) && !ignore(line)) indexes.push(offset);
    offset += line.length + 1;
  }
  return indexes;
}

function countMatches(text, regex) {
  return matchIndexes(text, regex).length;
}

function lastIndex(indexes) {
  return indexes.length === 0 ? -1 : Math.max(...indexes);
}

function completionSignals(text) {
  const checkedCount = countMatches(text, /^\s*-\s+\[[xX✓]\]\s+/gm);
  const uncheckedCount = countMatches(text, /^\s*-\s+\[\s\]\s+/gm);
  const explicitCompleted = /(?:^|\n)\s*(?:status|状态)[：:]\s*(?:completed|done|已完成)\s*(?:\n|$)/i.test(text);
  const archiveReady = /(?:可以归档|可归档|可标记完成|整体也可标记完成|任务状态[：:][^\n]*(?:归档|完成)|当前状态[：:][^\n]*已完成)/i.test(text);

  const positiveIndexes = matchIndexes(
    text,
    /(?:最终验证|完成前验证|验证完成|验收通过|全部通过|均通过|已测试通过|验证[：:][^\n]*通过|已完成(?:实现|交付|验证|迁移|修复)|\b\d+\s+pass\/0\s+fail\b|ALL_OK=true)/g,
  );
  const openIndexes = lineIndexes(
    text,
    /(?:-\s+\[\s\]\s+|待解决|待补充|待执行|下一步应|后续再|当前待继续点|仍需|未完成：)/,
    {
      ignore: (line) => /(?:后续是否|后续可|如需要|如果需要|未来|扩展更多|可归档|可以归档|剩余只是|不在本轮|按维护节奏|下次第一步|直接说|手动执行的真删|提交|push|commit)/.test(line),
    },
  );

  return {
    checkedCount,
    uncheckedCount,
    explicitCompleted,
    archiveReady,
    positiveCount: positiveIndexes.length,
    openCount: openIndexes.length,
    lastPositiveIndex: lastIndex(positiveIndexes),
    lastOpenIndex: lastIndex(openIndexes),
  };
}

function inferSuggestedState(group, text, markers = []) {
  if (group.state === '3_已完成') return null;

  const completedMarkers = markers.filter((marker) => ['completed', 'done', '已完成'].includes(marker.value));
  const blockingMarkers = markers.filter((marker) => ['in_progress', 'doing', 'blocked', '进行中', '阻塞'].includes(marker.value));
  if (completedMarkers.length > 0 && blockingMarkers.length === 0) {
    return {
      suggestedState: '3_已完成',
      reason: 'ADS frontmatter 中存在 completion_status: completed 标记，且同组三件套没有阻塞性完成度标记。',
      signals: {
        ...completionSignals(text),
        completionMarkers: markers,
      },
    };
  }
  if (blockingMarkers.length > 0) return null;

  const signals = completionSignals(text);
  const openWorkAfterEvidence = signals.lastOpenIndex > signals.lastPositiveIndex;
  const checklistComplete = signals.checkedCount > 0 && signals.uncheckedCount === 0;
  const validated = signals.positiveCount > 0;

  if (signals.explicitCompleted) {
    return {
      suggestedState: '3_已完成',
      reason: '文件正文或 frontmatter 已标记 completed/已完成。',
      signals,
    };
  }

  if (signals.archiveReady && !openWorkAfterEvidence) {
    return {
      suggestedState: '3_已完成',
      reason: '文件正文明确写出可以归档或可标记完成，且没有更晚的阻塞性开放事项。',
      signals,
    };
  }

  if (checklistComplete && validated && !openWorkAfterEvidence) {
    return {
      suggestedState: '3_已完成',
      reason: '所有 checklist 已完成，并且存在最终验证或验收证据。',
      signals,
    };
  }

  if (signals.positiveCount >= 2 && !openWorkAfterEvidence && signals.uncheckedCount === 0) {
    return {
      suggestedState: '3_已完成',
      reason: '存在多处完成和验证信号，且最后的开放事项没有晚于验证证据。',
      signals,
    };
  }

  return null;
}

export function analyzeAdsStateReview({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const groups = listAdsGroups(rootDir);
  const candidates = [];

  for (const group of groups) {
    const text = readGroupText(group);
    const completionMarkers = readGroupCompletionMarkers(group);
    const suggestion = inferSuggestedState(group, text, completionMarkers);
    if (!suggestion) continue;

    candidates.push({
      title: group.title,
      key: group.key,
      fromState: group.state,
      suggestedState: suggestion.suggestedState,
      reason: suggestion.reason,
      signals: suggestion.signals,
      completionMarkers,
      taskPlanPath: group.files.task_plan?.path || Object.values(group.files)[0]?.path,
      files: ADS_TYPES.map((type) => group.files[type]?.path).filter(Boolean),
      missingTypes: ADS_TYPES.filter((type) => !group.files[type]),
    });
  }

  return {
    groups: groups.length,
    candidates,
  };
}

export function parseModelReview(content) {
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);

  const fence = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (!fence) {
    throw new Error('模型总结文件必须是 JSON，或包含一个 ```json fenced block。');
  }

  return JSON.parse(fence[1]);
}

function readModelReviewFile(rootDir, reviewFile) {
  if (!reviewFile) throw new Error('apply 模式必须提供 --review-file <模型总结文件>');
  const fullPath = join(rootDir, reviewFile);
  const fallbackPath = reviewFile;
  const content = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : readFileSync(fallbackPath, 'utf8');
  const parsed = parseModelReview(content);
  if (!Array.isArray(parsed.decisions)) {
    throw new Error('模型总结文件必须包含 decisions 数组。');
  }
  return parsed;
}

function validateDecision(decision) {
  if (!decision.taskPlanPath) throw new Error('每个 decision 必须包含 taskPlanPath。');
  if (!ADS_STATES.includes(decision.targetState)) {
    throw new Error(`无效 targetState: ${decision.targetState}`);
  }
  if (!decision.summary || String(decision.summary).trim().length < 20) {
    throw new Error(`decision ${decision.taskPlanPath} 缺少足够明确的模型 summary。`);
  }
  if (!decision.reason || String(decision.reason).trim().length < 10) {
    throw new Error(`decision ${decision.taskPlanPath} 缺少足够明确的 reason。`);
  }
}

function findCandidateForDecision(candidates, decision) {
  const normalized = normalizePath(decision.taskPlanPath);
  return candidates.find((candidate) => normalizePath(candidate.taskPlanPath) === normalized);
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
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute} CST`;
}

function formatYyMMddHH(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${String(values.year).slice(-2)}-${values.month}${values.day}-${values.hour}`;
}

function replaceFrontmatterField(content, field, value) {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return content;

  const frontmatter = content.slice(0, end);
  const rest = content.slice(end);
  const pattern = new RegExp(`(^${field}:\\s*).*$`, 'm');
  if (pattern.test(frontmatter)) {
    return `${frontmatter.replace(pattern, `$1${value}`)}${rest}`;
  }
  return `${frontmatter}\n${field}: ${value}${rest}`;
}

function updateMetadata(content, targetState, now) {
  let updated = replaceFrontmatterField(content, 'status', TARGET_STATUS[targetState]);
  updated = replaceFrontmatterField(updated, 'completion_status', TARGET_COMPLETION_STATUS[targetState]);
  updated = replaceFrontmatterField(updated, 'completion_confidence', targetState === '3_已完成' ? 'high' : 'medium');
  updated = replaceFrontmatterField(updated, 'completion_evidence', targetState === '3_已完成' ? '模型归档总结已写入 progress。' : '仍需继续推进。');
  updated = replaceFrontmatterField(updated, 'updated', formatYyMMddHH(now));
  return updated;
}

function appendArchiveSummary(content, decision, now) {
  const summary = [
    '',
    '## 归档总结',
    '',
    `- 时间：${formatShanghaiMinute(now)}`,
    `- 目标状态：${decision.targetState}`,
    `- 模型总结：${String(decision.summary).trim()}`,
    `- 判定理由：${String(decision.reason).trim()}`,
    '',
  ].join('\n');

  return content.includes('## 归档总结') ? content : `${content.replace(/\s*$/, '\n')}${summary}`;
}

function refreshIndex(rootDir) {
  const result = spawnSync('bun', ['run', 'index'], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function moveCandidate(rootDir, candidate, decision, now) {
  const targetState = decision.targetState;
  const movedFiles = [];

  for (const relativePath of candidate.files) {
    const sourcePath = rootPath(rootDir, relativePath);
    const name = relativePath.split('/').pop();
    const targetRelativePath = normalizePath(join('04_ADS', targetState, name));
    const targetPath = rootPath(rootDir, targetRelativePath);
    mkdirSync(dirname(targetPath), { recursive: true });

    let content = readFileSync(sourcePath, 'utf8');
    content = updateMetadata(content, targetState, now);
    if (relativePath.includes('-progress-')) {
      content = appendArchiveSummary(content, decision, now);
    }
    writeFileSync(sourcePath, content, 'utf8');
    renameSync(sourcePath, targetPath);
    movedFiles.push(targetRelativePath);
  }

  const taskPlanPath = movedFiles.find((path) => path.includes('-task_plan-')) || movedFiles[0];
  const directionUpdated = updateDirectionWheel(rootDir, candidate.taskPlanPath, taskPlanPath, targetState);

  return {
    title: candidate.title,
    fromState: candidate.fromState,
    targetState,
    taskPlanPath,
    files: movedFiles,
    directionUpdated,
    summary: decision.summary,
    reason: decision.reason,
  };
}

function sectionNameForState(state) {
  if (state === '3_已完成') return '已完成';
  if (state === '2_进行中') return '进行中';
  return '收集';
}

function findBlockByAdsPath(lines, adsPath) {
  const linkIndex = lines.findIndex((line) => line.includes(`ADS：\`${adsPath}\``));
  if (linkIndex === -1) return null;

  let start = linkIndex;
  while (start > 0 && !/^[-*+]\s+/.test(lines[start])) {
    start -= 1;
  }
  if (!/^[-*+]\s+/.test(lines[start])) return null;

  let end = linkIndex + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (/^#{1,6}\s+/.test(line)) break;
    if (/^[-*+]\s+/.test(line) && !line.includes('ADS：`')) break;
    end += 1;
  }

  return { start, end, lines: lines.slice(start, end) };
}

function findSectionInsertIndex(lines, sectionName) {
  const headingIndex = lines.findIndex((line) => new RegExp(`^##\\s+${sectionName}\\s*$`).test(line));
  if (headingIndex === -1) {
    lines.push('', `## ${sectionName}`, '');
    return lines.length;
  }

  let insertIndex = headingIndex + 1;
  while (insertIndex < lines.length && lines[insertIndex].trim() === '') {
    insertIndex += 1;
  }
  return insertIndex;
}

function updateDirectionWheel(rootDir, oldTaskPlanPath, newTaskPlanPath, targetState) {
  const directionPath = rootPath(rootDir, '00_方向盘', '02_当前任务.md');
  if (!existsSync(directionPath)) return false;

  const content = readFileSync(directionPath, 'utf8');
  const lines = content.split('\n');
  const block = findBlockByAdsPath(lines, oldTaskPlanPath);
  if (!block) {
    const replaced = content.replaceAll(oldTaskPlanPath, newTaskPlanPath);
    if (replaced !== content) {
      writeFileSync(directionPath, replaced, 'utf8');
      return true;
    }
    return false;
  }

  const movedBlock = block.lines.map((line) => line.replaceAll(oldTaskPlanPath, newTaskPlanPath));
  lines.splice(block.start, block.end - block.start);

  const sectionName = sectionNameForState(targetState);
  const insertIndex = findSectionInsertIndex(lines, sectionName);
  lines.splice(insertIndex, 0, ...movedBlock, '');
  writeFileSync(directionPath, lines.join('\n').replace(/\n{4,}/g, '\n\n\n'), 'utf8');
  return true;
}

export function applyAdsStateReview({
  rootDir = DEFAULT_ROOT_DIR,
  reviewFile,
  updateIndex = true,
  now = new Date(),
} = {}) {
  const analysis = analyzeAdsStateReview({ rootDir });
  const review = readModelReviewFile(rootDir, reviewFile);
  const moved = [];
  const skipped = [];

  for (const decision of review.decisions) {
    validateDecision(decision);
    const candidate = findCandidateForDecision(analysis.candidates, decision);
    if (!candidate) {
      skipped.push({
        taskPlanPath: decision.taskPlanPath,
        reason: '不在当前候选列表中，未移动。',
      });
      continue;
    }

    if (decision.targetState === candidate.fromState) {
      skipped.push({
        taskPlanPath: decision.taskPlanPath,
        reason: '目标状态与当前状态相同，未移动。',
      });
      continue;
    }

    moved.push(moveCandidate(rootDir, candidate, decision, now));
  }

  const index = updateIndex && moved.length > 0 ? refreshIndex(rootDir) : { ok: true, skipped: true };
  return {
    analyzedCandidates: analysis.candidates,
    moved,
    skipped,
    index,
  };
}

export function formatAdsStateReviewReport(result) {
  const candidates = result.candidates ?? result.analyzedCandidates ?? [];
  const lines = [
    '# ADS 状态复核报告',
    '',
    `- 扫描任务组：${result.groups ?? '已应用复核'}`,
    `- 状态漂移候选：${candidates.length}`,
    '',
  ];

  if (candidates.length > 0) {
    lines.push('## 候选任务', '');
    for (const candidate of candidates) {
      lines.push(`- ${candidate.title}：${candidate.fromState} → ${candidate.suggestedState}`);
      lines.push(`  - task_plan：\`${candidate.taskPlanPath}\``);
      lines.push(`  - 理由：${candidate.reason}`);
    }
    lines.push('');
    lines.push('## 执行要求', '');
    lines.push('- 移动前必须由大模型写总结文件，并通过 `--review-file` 传入。');
  } else {
    lines.push('✅ 未发现需要复核的 ADS 状态漂移候选。');
  }

  if (result.moved) {
    lines.push('', '## 已移动', '');
    if (result.moved.length === 0) {
      lines.push('- 无。');
    } else {
      for (const item of result.moved) {
        lines.push(`- ${item.title}：${item.fromState} → ${item.targetState}`);
        lines.push(`  - 新 task_plan：\`${item.taskPlanPath}\``);
      }
    }
  }

  if (result.skipped && result.skipped.length > 0) {
    lines.push('', '## 跳过项', '');
    for (const item of result.skipped) {
      lines.push(`- \`${item.taskPlanPath}\`：${item.reason}`);
    }
  }

  if (result.index && !result.index.ok) {
    lines.push('', '## 索引刷新异常', '', '```text', result.index.stderr || result.index.stdout, '```');
  }

  return `${lines.join('\n')}\n`;
}

function printHelp() {
  console.log(`
ADS 状态复核工具

用法:
  bun run ads:review
  bun run ads:review -- --json
  bun run ads:review:apply -- --review-file 04_ADS/2_进行中/review.md

说明:
  默认只扫描候选，不移动文件。
  apply 必须传入模型写好的总结文件，文件可以是 JSON，也可以是包含 json fenced block 的 Markdown。
`);
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      apply: { type: 'boolean' },
      json: { type: 'boolean' },
      'review-file': { type: 'string' },
      'no-index': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const result = values.apply
    ? applyAdsStateReview({
        rootDir: process.cwd(),
        reviewFile: values['review-file'],
        updateIndex: !values['no-index'],
      })
    : analyzeAdsStateReview({ rootDir: process.cwd() });

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatAdsStateReviewReport(result));
  }

  if (result.index && !result.index.ok) process.exitCode = 1;
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : null;
if (entryPath && relative(process.argv[1], entryPath) === '') {
  main();
}
