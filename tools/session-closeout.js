#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const DEFAULT_ROOT_DIR = join(import.meta.dir, '..');
const INDEX_PATH = join('00_DIM', 'session-closeout', 'index.jsonl');
const CLOSEOUT_LOOP_REQUIREMENTS = [
  {
    id: 'opening',
    label: '开场确认',
    pattern: /(开场|轻量模板|完成标准|需求类型|我理解你)/,
    suggestion: '补一句：本轮开头如何确认目的、需求类型和完成标准。',
  },
  {
    id: 'purpose',
    label: '目的澄清',
    pattern: /(目的|真实目的|背后.*目的|要达成)/,
    suggestion: '补一句：Jack 这次真正想达成什么。',
  },
  {
    id: 'theme',
    label: '主题',
    pattern: /(主题|本次主题|提交主题)/,
    suggestion: '补一句：本轮收束的主题是什么。',
  },
  {
    id: 'solved_problem',
    label: '解决的问题',
    pattern: /(解决的问题|解决.*什么|问题.*解决|减少.*后续|修复|优化)/,
    suggestion: '补一句：本轮解决了什么具体问题。',
  },
  {
    id: 'demand',
    label: '需求确认',
    pattern: /(需求|需求类型|当前要的是|确认.*(解释|修改|执行|保存|学习|决策|检查))/,
    suggestion: '补一句：本轮需求类型是解释、修改、执行、保存、学习、决策还是检查。',
  },
  {
    id: 'strategic_bottleneck',
    label: '战略瓶颈',
    pattern: /(战略瓶颈|瓶颈|卡点|推进.*瓶颈|解决.*瓶颈)/,
    suggestion: '补一句：本轮推进了哪个战略瓶颈，不要只列任务。',
  },
  {
    id: 'plan',
    label: '计划先行',
    pattern: /(计划|执行计划|步骤|先.*再|最小.*计划)/,
    suggestion: '补一句：执行前采用的最小计划是什么。',
  },
  {
    id: 'progress',
    label: '本次进展',
    pattern: /(本次进展|战略推进|推进|进展)/,
    suggestion: '补一句：本轮具体推进了什么，而不是只列任务。',
  },
  {
    id: 'execution',
    label: '实际执行',
    pattern: /(执行|修改|写入|完成|实现|已做|变更)/,
    suggestion: '补一句：实际做了哪些事，涉及哪些文件或命令。',
  },
  {
    id: 'verification',
    label: '验证检测',
    pattern: /(验证|测试|检查|doctor|rules:resolve|通过|失败|无法验证)/,
    suggestion: '补一句：用什么命令、测试、检索或人工标准验证。',
  },
  {
    id: 'completion',
    label: '达成判断',
    pattern: /(达成|是否达成|闭环|满足|未达成|阻塞|下一步)/,
    suggestion: '补一句：Jack 的原始需求是否已经达成；未达成时下一步是什么。',
  },
  {
    id: 'file_descriptions',
    label: '文件说明',
    pattern: /(文件说明|文件更改|文件变更|更改的文件|按主题分组的变更文件)/,
    suggestion: '补一句：每个变更文件分别改了什么，用一两句话说明。',
  },
];

function needsFailureEvolution(text) {
  const normalized = String(text || '')
    .replace(/失败命令[：:]\s*(无|没有|none|None|0)/g, '')
    .replace(/未发现(错误|失败|异常|报错|超时)/g, '')
    .replace(/无(错误|失败|异常|报错|超时)/g, '')
    .replace(/没有(错误|失败|异常|报错|超时)/g, '')
    .replace(/no\s+(failures?|errors?|timeouts?)/gi, '');
  return /(失败|报错|错误|异常|超时|修复|纠正|bug|Bug|failed|failure|error|timeout|fix|fixed|cron|Cron|watchdog|工具失败)/.test(normalized);
}

function hasFailureEvolutionBlock(text) {
  const normalized = String(text || '');
  if (!/失败进化[：:]/.test(normalized)) return false;
  return [
    /失败现象[：:]/,
    /根因[：:]/,
    /同类风险[：:]/,
    /已修复[：:]/,
    /已预防[：:]/,
    /验证[：:]/,
  ].every((pattern) => pattern.test(normalized));
}

function checkCloseoutLoop(text) {
  const normalized = String(text || '').trim();
  const missing = CLOSEOUT_LOOP_REQUIREMENTS.filter((item) => !item.pattern.test(normalized));
  if (needsFailureEvolution(normalized) && !hasFailureEvolutionBlock(normalized)) {
    missing.push({
      id: 'failure_evolution',
      label: '失败进化',
      suggestion: '本轮涉及失败/修复/报错/纠正，补充“失败进化：失败现象 / 根因 / 同类风险 / 已修复 / 已预防 / 验证 / 后续”。',
    });
  }
  return {
    ok: missing.length === 0,
    missing: missing.map((item) => item.label),
    suggestions: missing.map((item) => item.suggestion),
  };
}

function runGit(rootDir, args, { allowFail = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });
  if (!allowFail && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function gitStatus(rootDir) {
  return runGit(rootDir, ['status', '--short', '--untracked-files=all']).stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function changedPath(statusLine) {
  return parseStatusLine(statusLine).path;
}

function parseStatusLine(statusLine) {
  const trimmed = String(statusLine || '').trim();
  const match = trimmed.match(/^([ MADRCU?!]{1,2})\s+(.+)$/);
  const status = match ? match[1].trim() : '';
  const rawPath = match ? match[2] : trimmed;
  return {
    status,
    path: rawPath.replace(/^.* -> /, '').trim(),
  };
}

function extractLabeledField(text, labels) {
  const alternation = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const nextLabel = '主题|目的澄清|解决的问题|战略推进|战略瓶颈|需求确认|计划先行|本次进展|实际执行|验证检测|达成判断|文件说明|文件更改|文件变更|更改的文件|按主题分组的变更文件';
  const match = String(text || '').match(new RegExp(`(?:${alternation})[：:]\\s*([\\s\\S]*?)(?=\\s*(?:${nextLabel})[：:]|$)`));
  return match ? match[1].trim() : '';
}

function parseFileDescriptions(text) {
  const body = extractLabeledField(text, ['文件说明', '文件更改', '文件变更', '更改的文件', '按主题分组的变更文件']);
  const descriptions = new Map();
  if (!body) return descriptions;

  const pattern = /([.\w\u4e00-\u9fff/-]+)\s*[：:]\s*([^；;\n]+)/g;
  for (const match of body.matchAll(pattern)) {
    descriptions.set(match[1].trim(), match[2].trim());
  }
  return descriptions;
}

function summarizeCloseout(summary) {
  const theme = extractLabeledField(summary, ['主题']);
  const solvedProblem = extractLabeledField(summary, ['解决的问题']);
  const purpose = extractLabeledField(summary, ['战略推进', '目的澄清']);
  const bottleneck = extractLabeledField(summary, ['战略瓶颈']) || purpose;
  const progress = extractLabeledField(summary, ['本次进展', '战略推进']);
  const execution = extractLabeledField(summary, ['实际执行']);
  const verification = extractLabeledField(summary, ['验证检测']);
  const completion = extractLabeledField(summary, ['达成判断']);
  const fileDescriptions = parseFileDescriptions(summary);
  return {
    theme,
    solvedProblem,
    purpose,
    bottleneck,
    progress,
    execution,
    verification,
    completion,
    fileDescriptions,
  };
}

function fileGroup(path) {
  if (path.startsWith('00_方向盘/')) return '方向盘';
  if (path.startsWith('00_DIM/')) return 'DIM规则与记忆';
  if (path.startsWith('01_ODS/')) return '原始资料';
  if (path.startsWith('02_DWD/')) return '分析明细';
  if (path.startsWith('03_DWS/')) return 'DWS沉淀与蓝图';
  if (path.startsWith('04_ADS/')) return 'ADS任务进展';
  if (path.startsWith('.agents/') || path.startsWith('.claude/') || path.includes('skills/')) return '技能与入口';
  if (path.startsWith('tools/') || path.endsWith('.js') || path.endsWith('.test.js')) return '工具与测试';
  return '其他';
}

function groupChangedFiles(files) {
  const groups = new Map();
  for (const file of files) {
    const entry = typeof file === 'string' ? parseStatusLine(file) : file;
    if (!entry.path) continue;
    const group = fileGroup(entry.path);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }
  return [...groups.entries()].map(([name, entries]) => ({ name, entries }));
}

function markdownFileLink(rootDir, path) {
  const absolutePath = join(rootDir, path);
  const target = absolutePath.includes(' ') ? `<${absolutePath}>` : absolutePath;
  return `[${path}](${target})`;
}

function fileDescription(path, descriptions) {
  return descriptions.get(path) || describeFileGroup({ name: fileGroup(path), entries: [{ path }] });
}

function formatChangedFileGroups(rootDir, changedFiles, descriptions = new Map()) {
  const groups = groupChangedFiles(changedFiles);
  if (groups.length === 0) return ['- 无文件变更。'];
  return groups.flatMap((group) => [
    `- ${group.name}：${group.entries.length} 个文件`,
    ...group.entries.map((entry) => {
      const status = entry.status ? `${entry.status} ` : '';
      return [
        `  - ${status}${markdownFileLink(rootDir, entry.path)}`,
        `    - 变更说明：${fileDescription(entry.path, descriptions)}`,
      ].join('\n');
    }),
  ]);
}

function describeFileGroup(group) {
  const paths = group.entries.map((entry) => entry.path);
  if (group.name === '规则与系统约定') return '更新稳定规则、索引或系统约定，让后续会话按同一套入口执行。';
  if (group.name === '技能与入口') return '调整技能说明或命令入口，保证触发词能路由到当前权威流程。';
  if (group.name === '工具与测试') return '更新执行脚本和回归测试，把本次行为固化为可验证的工具能力。';
  if (group.name === '任务状态') return '更新 ADS 任务计划、发现或进度，让当前推进结果在任务流中有痕。';
  if (group.name === '主题沉淀') return '更新 DWS 主题沉淀或索引，让复盘时能从主题层看到结果。';
  if (group.name === '方向盘') return '更新 Jack 高频控制面板，让战略方向和下一步保持可见。';
  if (paths.length === 1) return `更新 ${paths[0]}，承接本轮收束需要。`;
  return '更新相关文件，承接本轮收束需要。';
}

function readCloseoutRecords(rootDir) {
  const path = join(rootDir, INDEX_PATH);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendCloseoutRecord(rootDir, record) {
  const path = join(rootDir, INDEX_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : '';
  writeFileSync(path, `${previous}${JSON.stringify(record)}\n`, 'utf8');
}

function buildJcCommitMessage({ summary, changedFiles }) {
  const closeout = summarizeCloseout(summary);
  const groupedFiles = groupChangedFiles(changedFiles);
  return [
    'chore: 会话收束',
    '',
    '主题：',
    closeout.theme || '会话收束',
    '',
    '解决的问题：',
    closeout.solvedProblem || closeout.purpose || summary,
    '',
    '战略推进：',
    closeout.progress || closeout.purpose || summary,
    '',
    '战略瓶颈：',
    closeout.bottleneck || '本次总结未单独标注战略瓶颈；请参考战略推进与实际执行。',
    '',
    '实际执行：',
    closeout.execution || summary,
    '',
    '验证检测：',
    closeout.verification || '已通过 jc 闭环检查。',
    '',
    '达成判断：',
    closeout.completion || '当前会话已完成本地收束提交。',
    '',
    '文件分组：',
    ...groupedFiles.flatMap((group) => [
      `- ${group.name}`,
      ...group.entries.map((entry) => `  - ${entry.status ? `${entry.status} ` : ''}${entry.path}`),
    ]),
  ].join('\n');
}

function buildJcReport({ rootDir, summary, commitHash, changedFiles, pushed }) {
  const closeout = summarizeCloseout(summary);
  return [
    '## /jc 本地收束',
    '',
    `已执行 /jc，完成本地收束${commitHash ? '提交' : '记录'}，${pushed ? '已 push' : '未 push'}。`,
    '',
    commitHash ? `提交：\`${commitHash}\` \`chore: 会话收束\`` : '提交：未创建新提交。',
    '',
    '### 主题',
    closeout.theme || '会话收束',
    '',
    '### 解决的问题',
    closeout.solvedProblem || closeout.purpose || summary,
    '',
    '### 推进的战略瓶颈',
    closeout.bottleneck || '本次总结未单独标注战略瓶颈；请参考主题和实际执行。',
    '',
    '### 本次进展',
    closeout.progress || closeout.purpose || summary,
    '',
    '### 实际执行',
    closeout.execution || summary,
    '',
    '### 验证检测',
    closeout.verification || '已通过 jc 闭环检查。',
    '',
    '### 达成判断',
    closeout.completion || '当前会话已完成本地收束。',
    '',
    '### 按主题分组的变更文件',
    ...formatChangedFileGroups(rootDir, changedFiles, closeout.fileDescriptions),
  ].join('\n');
}

function buildAggregateSummary(records) {
  const jcRecords = records.filter((record) => record.mode === 'jc');
  if (jcRecords.length === 0) return '';
  const loopGaps = jcRecords
    .map((record) => ({ record, check: record.closeout_loop || checkCloseoutLoop(record.summary) }))
    .filter((item) => !item.check.ok);
  return [
    'jp 总揽摘要：',
    ...jcRecords.map((record) => {
      const commit = record.commit ? ` (${record.commit})` : '';
      return `- ${record.summary}${commit}`;
    }),
    '',
    '闭环检查：',
    loopGaps.length === 0
      ? '- 所有 jc 记录都包含开场确认、主题、目的澄清、解决的问题、战略瓶颈、需求确认、计划、执行、验证和达成判断。'
      : `- ${loopGaps.length} 条 jc 记录闭环不完整，需要下次 jc 补齐。`,
    ...loopGaps.map((item) => {
      const created = item.record.created_at || 'unknown-time';
      return `- ${created}: 缺少 ${item.check.missing.join('、')}；建议：${item.check.suggestions.join('；')}`;
    }),
  ].join('\n');
}

function buildJpCommitMessage({ aggregateSummary }) {
  return [
    'chore: 会话总揽同步',
    '',
    aggregateSummary,
    '',
    '依据：各会话 jc closeout 记录与 git log。',
  ].join('\n');
}

export function runSessionCloseout({
  rootDir = DEFAULT_ROOT_DIR,
  mode = 'jc',
  summary = '',
  commit = false,
  push = false,
  aggregate = false,
  now = new Date(),
} = {}) {
  if (mode === 'jc') {
    const normalizedSummary = summary.trim();
    if (!normalizedSummary) {
      return {
        status: 'missing-summary',
        committed: false,
        pushed: false,
        message: 'jc 需要当前会话模型先提供 closeout summary；不要从外部 transcript 自动抽取。',
      };
    }

    const closeoutLoop = checkCloseoutLoop(normalizedSummary);
    if (!closeoutLoop.ok) {
      return {
        status: 'missing-closeout-loop',
        committed: false,
        pushed: false,
        closeoutLoop,
        message: [
          'jc 需要当前会话模型先完成闭环总结：开场确认、主题、目的澄清、解决的问题、战略瓶颈、需求确认、计划先行、本次进展、实际执行、验证检测、达成判断、文件说明；若本轮涉及失败/修复/报错/超时/工具或命令失败/用户纠正，还必须包含失败进化。',
          `缺少：${closeoutLoop.missing.join('、')}`,
          `补全建议：${closeoutLoop.suggestions.join('；')}`,
        ].join('\n'),
      };
    }

    const changedFilesBeforeRecord = gitStatus(rootDir).map(changedPath);
    const pendingRecord = {
      mode: 'jc',
      created_at: now.toISOString(),
      summary: normalizedSummary,
      changed_files: changedFilesBeforeRecord,
      closeout_loop: closeoutLoop,
      commit: null,
    };
    appendCloseoutRecord(rootDir, pendingRecord);

    const changedFiles = gitStatus(rootDir).map(changedPath);
    if (!commit) {
      return {
        status: 'recorded',
        committed: false,
        pushed: false,
        changedFiles,
        report: buildJcReport({ rootDir, summary: normalizedSummary, commitHash: null, changedFiles, pushed: false }),
      };
    }

    if (changedFiles.length === 0) {
      return {
        status: 'no-changes',
        committed: false,
        pushed: false,
        changedFiles,
        report: buildJcReport({ rootDir, summary: normalizedSummary, commitHash: null, changedFiles, pushed: false }),
      };
    }

    runGit(rootDir, ['add', '-A']);
    const message = buildJcCommitMessage({ summary: normalizedSummary, changedFiles });
    runGit(rootDir, ['-c', 'user.name=Codex', '-c', 'user.email=codex@example.local', 'commit', '-m', message]);
    const commitHash = runGit(rootDir, ['rev-parse', '--short', 'HEAD']).stdout.trim();

    return {
      status: 'committed',
      committed: true,
      pushed: false,
      commit: commitHash,
      changedFiles,
      report: buildJcReport({ rootDir, summary: normalizedSummary, commitHash, changedFiles, pushed: false }),
    };
  }

  if (mode === 'jp') {
    const records = readCloseoutRecords(rootDir);
    const aggregateSummary = buildAggregateSummary(records);
    if (!aggregateSummary) {
      return {
        status: 'missing-jc-records',
        committed: false,
        pushed: false,
        message: 'jp 没有可用的 jc closeout 记录，不能从 transcript 重建总揽。',
      };
    }

    if (!commit) {
      return {
        status: 'aggregate-ready',
        committed: false,
        pushed: false,
        aggregateSummary,
      };
    }

    const changedFiles = gitStatus(rootDir).map(changedPath);
    if (changedFiles.length > 0) {
      runGit(rootDir, ['add', '-A']);
      runGit(rootDir, [
        '-c',
        'user.name=Codex',
        '-c',
        'user.email=codex@example.local',
        'commit',
        '-m',
        buildJpCommitMessage({ aggregateSummary }),
      ]);
    }

    let pushed = false;
    if (push) {
      const branch = runGit(rootDir, ['branch', '--show-current']).stdout.trim();
      const result = runGit(rootDir, ['push', 'origin', branch], { allowFail: true });
      if (!result.ok) {
        return {
          status: 'push-failed',
          committed: changedFiles.length > 0,
          pushed: false,
          aggregateSummary,
          message: result.stderr || result.stdout,
        };
      }
      pushed = true;
    }

    return {
      status: pushed ? 'pushed' : 'aggregate-committed',
      committed: changedFiles.length > 0,
      pushed,
      aggregateSummary,
      changedFiles,
    };
  }

  throw new Error(`未知 closeout 模式：${mode}`);
}

function readSummaryFromArgs(args) {
  const inline = args.find((arg) => arg.startsWith('--summary='));
  if (inline) return inline.slice('--summary='.length);

  const file = args.find((arg) => arg.startsWith('--summary-file='));
  if (file) return readFileSync(file.slice('--summary-file='.length), 'utf8');

  return '';
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--aggregate') || args.includes('--mode=jp') ? 'jp' : 'jc';
  const jsonOutput = args.includes('--json');
  const result = runSessionCloseout({
    rootDir: DEFAULT_ROOT_DIR,
    mode,
    summary: readSummaryFromArgs(args),
    commit: args.includes('--commit'),
    push: args.includes('--push'),
    aggregate: args.includes('--aggregate'),
  });

  if (jsonOutput || !result.report) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.report);
  }
  if (result.status === 'missing-summary' || result.status === 'missing-jc-records' || result.status === 'push-failed') {
    process.exit(1);
  }
  if (result.status === 'missing-closeout-loop') {
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('tools/session-closeout.js')) {
  main();
}
