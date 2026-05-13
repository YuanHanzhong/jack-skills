#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { analyzeAdsStateReview } from './ads-state-review.js';

const ROOT_DIR = process.cwd();
const GENERATED_INDEX_PATHS = [
  '00_DIM/RULE_MANIFEST.md',
  '00_DIM/INDEX.md',
  '03_DWS/INDEX.md',
  '04_ADS/INDEX.md',
];

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });

  if (result.status !== 0 && !allowFailure) {
    const details = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`${[command, ...args].join(' ')} failed\n${details}`);
  }

  return result;
}

function git(args, options) {
  return run('git', args, options);
}

function changedFiles() {
  const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { allowFailure: true })
    .stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const unstaged = git(['diff', '--name-only', '--diff-filter=ACMR'], { allowFailure: true })
    .stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    files: [...new Set([...staged, ...unstaged])],
    source: staged.length > 0 && unstaged.length > 0
      ? 'staged/worktree'
      : staged.length > 0 ? 'staged' : 'worktree',
  };
}

function isAdsDoc(path) {
  return path.startsWith('04_ADS/') && path.endsWith('.md') && !path.endsWith('/INDEX.md');
}

function isRuleDoc(path) {
  return path.startsWith('00_DIM/rules/') && path.endsWith('.md');
}

function stageGeneratedFiles() {
  const existing = GENERATED_INDEX_PATHS.filter((path) => existsSync(join(ROOT_DIR, path)));
  if (existing.length > 0) {
    git(['add', ...existing], { allowFailure: true });
  }
}

function runRulesCascade() {
  console.log('[doc-change-guard] 规则文档已变更，刷新规则清单和索引...');
  run('bun', ['run', 'rules:manifest', '--', '--write']);
  run('bun', ['run', 'index']);
  stageGeneratedFiles();
}

function runAdsChecks(changedAdsFiles) {
  console.log('[doc-change-guard] ADS 文档已变更，检查命名和状态流转...');
  run('bun', ['run', 'check', '--', '--layer=ADS']);

  const review = analyzeAdsStateReview({ rootDir: ROOT_DIR });
  const changed = new Set(changedAdsFiles);
  const candidates = review.candidates.filter((candidate) =>
    candidate.files.some((file) => changed.has(file)),
  );

  if (candidates.length === 0) return;

  const lines = [
    'ADS 状态可能已完成但仍滞留在当前目录，提交前需要先完成状态流转：',
    '',
    ...candidates.map((candidate) => (
      `- ${candidate.title}: ${candidate.fromState} -> ${candidate.suggestedState}\n` +
      `  task_plan: ${candidate.taskPlanPath}\n` +
      `  reason: ${candidate.reason}`
    )),
    '',
    '请先由模型写 ADS 状态复核总结，再运行：',
    'bun run ads:review:apply -- --review-file <总结文件>',
    '',
    '完成移动和索引刷新后再提交。',
  ];

  throw new Error(lines.join('\n'));
}

function main() {
  const { files, source } = changedFiles();
  if (files.length === 0) {
    console.log('[doc-change-guard] 无待检查文档变更。');
    return;
  }

  const adsFiles = files.filter(isAdsDoc);
  const ruleFiles = files.filter(isRuleDoc);

  if (adsFiles.length === 0 && ruleFiles.length === 0) {
    console.log(`[doc-change-guard] ${source} 变更不涉及 ADS/规则文档。`);
    return;
  }

  if (ruleFiles.length > 0) runRulesCascade();
  if (adsFiles.length > 0) runAdsChecks(adsFiles);

  console.log('[doc-change-guard] 文档变更守门检查通过。');
}

try {
  main();
} catch (error) {
  console.error(`\n[doc-change-guard] ${error.message}\n`);
  process.exit(1);
}
