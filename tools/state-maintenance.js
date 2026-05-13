#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

import { analyzeDirectionSync, applyDirectionSync } from './direction-sync.js';
import { discoverProjectConfig, formatToolCatalog } from './config-discovery.js';
import { analyzeKnowledgeHealth } from './knowledge-health-core.js';
import { analyzeAdsStateReview, applyAdsStateReview } from './ads-state-review.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');

const INDEX_TARGETS = [
  { layer: '00_DIM', index: '00_DIM/INDEX.md' },
  { layer: '03_DWS', index: '03_DWS/INDEX.md' },
  { layer: '04_ADS', index: '04_ADS/INDEX.md' },
];

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function walkMarkdown(dir, rootDir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const relPath = normalizePath(relative(rootDir, fullPath));
    if (entry.isDirectory()) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      walkMarkdown(fullPath, rootDir, files);
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.endsWith('.md') &&
      !['INDEX.md', 'TOOL_CATALOG.md'].includes(entry.name)
    ) {
      files.push({ path: relPath, mtimeMs: statSync(fullPath).mtimeMs });
    }
  }
  return files;
}

function indexStatus(rootDir) {
  return INDEX_TARGETS.map((target) => {
    const files = walkMarkdown(join(rootDir, target.layer), rootDir);
    const newestSource = files.reduce((max, file) => Math.max(max, file.mtimeMs), 0);
    const indexPath = join(rootDir, target.index);
    const indexMtime = existsSync(indexPath) ? statSync(indexPath).mtimeMs : 0;

    return {
      layer: target.layer,
      index: target.index,
      sourceFiles: files.length,
      missing: !existsSync(indexPath),
      stale: newestSource > indexMtime,
    };
  });
}

function runCommand(rootDir, command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });

  return {
    command: [command, ...args].join(' '),
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function commandTail(result) {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  if (!text) return result.ok ? '无输出' : '无错误详情';
  return text.split('\n').filter(Boolean).slice(-6).join('\n');
}

export function summarizeKnowledgeHealth(report) {
  const summary = {
    odsMissingSha256: report.odsHash.missing.length,
    odsHashDrifted: report.odsHash.drifted.length,
    missingConfidence: report.quality.missingConfidence.length,
    missingSources: report.quality.missingSources.length,
    lowConfidence: report.quality.lowConfidence.length,
    contested: report.quality.contested.length,
    orphanPages: report.links.orphans.length,
    brokenWikiLinks: report.links.broken.length,
    incompleteAdsGroups: report.adsGroups.incomplete.length,
    completedAdsWithoutDws: report.adsGroups.completedWithoutDws.length,
    directionMissingAdsLinks: report.direction.missingAdsLinks.length,
    brokenRelations: report.metadata.brokenRelations.length,
    brokenEvidenceRefs: report.evidence.brokenRefs.length,
  };

  summary.totalDebt = Object.values(summary).reduce((total, value) => total + value, 0);
  return summary;
}

export async function runStateMaintenance({
  rootDir = DEFAULT_ROOT_DIR,
  apply = false,
  adsReviewFile = null,
  runIndex = apply,
  runNamingCheck = true,
  now = new Date(),
} = {}) {
  const directionPlan = analyzeDirectionSync({ rootDir });
  const directionApplied = apply
    ? applyDirectionSync({ rootDir, updateIndex: false, now }).applied
    : [];
  const directionAfter = apply ? analyzeDirectionSync({ rootDir }) : directionPlan;
  const adsStateBefore = analyzeAdsStateReview({ rootDir });
  const adsStateApplied = apply && adsReviewFile
    ? applyAdsStateReview({ rootDir, reviewFile: adsReviewFile, updateIndex: false, now })
    : null;
  const adsStateAfter = analyzeAdsStateReview({ rootDir });

  const catalog = await discoverProjectConfig({ rootDir });
  let catalogWritten = false;
  if (apply) {
    const outputPath = join(rootDir, '00_DIM', 'TOOL_CATALOG.md');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, formatToolCatalog(catalog), 'utf8');
    catalogWritten = true;
  }

  const indexesBefore = indexStatus(rootDir);
  const indexCommand = runIndex ? runCommand(rootDir, 'bun', ['run', 'index']) : null;
  const indexesAfter = runIndex ? indexStatus(rootDir) : indexesBefore;

  const namingCommand = runNamingCheck ? runCommand(rootDir, 'bun', ['run', 'check']) : null;
  const healthReport = await analyzeKnowledgeHealth({ rootDir });

  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    mode: apply ? 'apply' : 'dry-run',
    direction: {
      tasks: directionAfter.tasks,
      actions: directionPlan.actions,
      applied: directionApplied,
      remainingActions: directionAfter.actions,
    },
    adsStateReview: {
      before: adsStateBefore,
      applied: adsStateApplied,
      after: adsStateAfter,
      candidates: adsStateAfter.candidates,
    },
    catalog: {
      commands: catalog.commands.length,
      configs: catalog.configs.length,
      written: catalogWritten,
    },
    indexes: {
      before: indexesBefore,
      after: indexesAfter,
      command: indexCommand,
    },
    naming: {
      command: namingCommand,
    },
    health: {
      summary: summarizeKnowledgeHealth(healthReport),
    },
  };
}

function formatBool(ok) {
  return ok ? '✅' : '⚠️';
}

function firstActionSentence(result) {
  if (result.mode === 'apply') {
    if (result.direction.applied.length > 0) {
      return `已执行 ${result.direction.applied.length} 个方向盘到 ADS 同步动作。`;
    }
    return '方向盘与 ADS 已对齐，无需执行同步。';
  }

  if (result.direction.actions.length > 0) {
    return `发现 ${result.direction.actions.length} 个待同步动作，运行 \`bun run state:maintain:apply\` 可收口。`;
  }
  return '方向盘与 ADS 已对齐。';
}

export function formatStateMaintenanceReport(result) {
  const staleIndexes = result.indexes.after.filter((item) => item.missing || item.stale);
  const health = result.health.summary;
  const naming = result.naming.command;
  const indexCommand = result.indexes.command;
  const adsCandidates = result.adsStateReview?.candidates ?? [];
  const adsMoved = result.adsStateReview?.applied?.moved ?? [];
  const totalStrategicDebt = [
    health.odsMissingSha256,
    health.missingConfidence,
    health.missingSources,
    health.orphanPages,
    health.incompleteAdsGroups,
    health.completedAdsWithoutDws,
    health.directionMissingAdsLinks,
  ].reduce((total, value) => total + value, 0);

  const lines = [
    '# 状态一致性维护报告',
    '',
    `> 模式：${result.mode}`,
    `> 生成时间：${result.generatedAt}`,
    '',
    '## 战略目的',
    '',
    '- 让 Jack 只看方向盘和战略进度，任务只作为证据，不作为主视图。',
    '- 让 Codex 维护 ADS、DWS、DIM、索引、命名和工具目录的一致性。',
    '',
    '## 战略瓶颈',
    '',
    '- 当前瓶颈是执行层状态容易滞后于真实工具状态，导致汇报时把旧任务状态当成事实。',
    '',
    '## 长期方向进展',
    '',
    `- ${formatBool(result.direction.remainingActions.length === 0)} 方向盘执行闭环：${firstActionSentence(result)}`,
    `- ${formatBool(result.catalog.commands > 0)} 工具可发现性：识别 ${result.catalog.commands} 个命令、${result.catalog.configs} 个配置项${result.catalog.written ? '，已刷新 TOOL_CATALOG' : ''}。`,
    `- ${formatBool(staleIndexes.length === 0)} 索引一致性：${staleIndexes.length === 0 ? 'INDEX 文件当前无明显过期' : `${staleIndexes.length} 个索引可能过期`}。`,
    `- ${formatBool(!naming || naming.ok)} 命名一致性：${naming ? (naming.ok ? '命名检查通过' : '命名检查失败') : '本轮未运行命名检查'}。`,
    `- ${formatBool(adsCandidates.length === 0)} ADS 状态复核：${adsMoved.length > 0 ? `已按模型总结移动 ${adsMoved.length} 个任务组` : (adsCandidates.length === 0 ? '未发现进行中/已完成漂移候选' : `发现 ${adsCandidates.length} 个候选，移动前需要模型总结文件`)}。`,
    `- ${formatBool(totalStrategicDebt === 0)} 知识健康债务：核心债务 ${totalStrategicDebt} 项，其中 ODS 缺 sha256 ${health.odsMissingSha256}、主题缺来源/置信度 ${health.missingSources + health.missingConfidence}、孤岛 ${health.orphanPages}、ADS 结构债 ${health.incompleteAdsGroups + health.completedAdsWithoutDws}。`,
    '',
    '## 最小下一步',
    '',
  ];

  if (result.mode !== 'apply' && result.direction.actions.length > 0) {
    lines.push('- 运行 `bun run state:maintain:apply`，先收口方向盘和 ADS。');
  } else if (staleIndexes.length > 0) {
    lines.push('- 运行 `bun run index` 刷新索引。');
  } else if (naming && !naming.ok) {
    lines.push('- 先修复命名检查失败项。');
  } else if (adsCandidates.length > 0) {
    lines.push('- 先让模型为 ADS 状态漂移候选写总结，再运行 `bun run ads:review:apply -- --review-file <总结文件>` 或 `bun run state:maintain:apply -- --ads-review <总结文件>`。');
  } else if (totalStrategicDebt > 0) {
    lines.push('- 保持方向盘闭环稳定后，再按 ODS hash、主题来源、孤岛页面顺序处理健康债务。');
  } else {
    lines.push('- 当前可进入真实任务验证：Jack 只改方向盘，Codex 维护执行层。');
  }

  if (indexCommand && !indexCommand.ok) {
    lines.push('', '## 索引命令异常', '', '```text', commandTail(indexCommand), '```');
  }
  if (naming && !naming.ok) {
    lines.push('', '## 命名命令异常', '', '```text', commandTail(naming), '```');
  }
  if (adsCandidates.length > 0) {
    lines.push('', '## ADS 状态复核候选', '');
    for (const candidate of adsCandidates) {
      lines.push(`- ${candidate.title}：${candidate.fromState} → ${candidate.suggestedState}`);
      lines.push(`  - task_plan：\`${candidate.taskPlanPath}\``);
      lines.push(`  - 理由：${candidate.reason}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function parseArgs(args) {
  return {
    apply: args.includes('--apply'),
    failOnIssues: args.includes('--fail-on-issues'),
    json: args.includes('--json'),
    noIndex: args.includes('--no-index'),
    noNaming: args.includes('--no-naming'),
    adsReviewFile: readValueArg(args, '--ads-review'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function readValueArg(args, name) {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);

  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] || null;
  return null;
}

function printHelp() {
  console.log(`
状态一致性维护工具

使用方法:
  bun run state:maintain
  bun run state:maintain:apply
  bun run state:maintain:check
  bun run state:maintain --json

默认只读输出战略视角摘要；--apply 会执行方向盘 ADS 同步、刷新 TOOL_CATALOG、刷新 INDEX 并运行命名检查。
如需移动 ADS 状态复核候选，--apply 时必须额外传入 --ads-review <模型总结文件>。
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await runStateMaintenance({
    rootDir: process.cwd(),
    apply: options.apply,
    adsReviewFile: options.adsReviewFile,
    runIndex: options.apply && !options.noIndex,
    runNamingCheck: !options.noNaming,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatStateMaintenanceReport(result));
  }

  const namingFailed = result.naming.command && !result.naming.command.ok;
  const indexFailed = result.indexes.command && !result.indexes.command.ok;
  const hasOpenIssues = result.direction.remainingActions.length > 0 || result.adsStateReview.candidates.length > 0;
  if (namingFailed || indexFailed || (options.failOnIssues && hasOpenIssues)) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ 状态一致性维护失败: ${error.message}`);
    process.exit(1);
  });
}
