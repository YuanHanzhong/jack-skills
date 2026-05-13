#!/usr/bin/env bun

import { analyzeKnowledgeHealth } from './knowledge-health-core.js';

function addSuggestion(suggestions, type, path, action, detail = '') {
  suggestions.push({ type, path, action, detail });
}

export async function runKnowledgeLint({ rootDir = process.cwd(), fixSuggestions = false } = {}) {
  const report = await analyzeKnowledgeHealth({ rootDir });
  const suggestions = [];

  report.odsHash.missing.forEach((item) => {
    addSuggestion(
      suggestions,
      'ods_missing_sha256',
      item.path,
      '补充正文 sha256 元数据；建议由专用迁移器生成可审查 patch，不要手写 hash。',
      'ODS 原始层只允许受控工具更新元数据。'
    );
  });

  report.odsHash.drifted.forEach((item) => {
    addSuggestion(
      suggestions,
      'ods_hash_drift',
      item.path,
      '核对 ODS 是否被误改；如确为重新导入，应保留来源记录并更新 sha256。',
      `expected=${item.expected} actual=${item.actual}`
    );
  });

  report.quality.missingConfidence.forEach((item) => {
    addSuggestion(
      suggestions,
      'missing_quality_signal',
      item.path,
      '补充 confidence: high/medium/low，并说明判断依据。'
    );
  });

  report.quality.missingSources.forEach((item) => {
    addSuggestion(
      suggestions,
      'missing_sources',
      item.path,
      '补充 sources 或关联来源，确保结论可追溯。'
    );
  });

  report.links.broken.forEach((item) => {
    addSuggestion(
      suggestions,
      'broken_wikilink',
      item.from,
      `修复或移除断裂 wikilink：[[${item.target}]]。`
    );
  });

  report.links.orphans.forEach((item) => {
    addSuggestion(
      suggestions,
      'orphan_page',
      item.path,
      '补充至少 2 个相关 DWD/DWS 链接，或确认该页应归档。'
    );
  });

  report.schemas.missing.forEach((item) => {
    addSuggestion(
      suggestions,
      'missing_schema',
      item.path,
      `该主题目录已有 ${item.pageCount} 页，建议按模板补充 SCHEMA.md。`
    );
  });

  report.adsGroups.incomplete.forEach((item) => {
    addSuggestion(
      suggestions,
      'incomplete_ads_group',
      `04_ADS/*/${item.key}`,
      `补齐 ADS 三件套：缺少 ${item.missingTypes.join(', ')}。`
    );
  });

  report.direction.missingAdsLinks.forEach((item) => {
    addSuggestion(
      suggestions,
      'direction_missing_ads_link',
      item.path,
      `方向盘任务缺 ADS 链接：第 ${item.line} 行。`
    );
  });

  return {
    generatedAt: report.generatedAt,
    fixSuggestions,
    suggestions,
    issueCount: suggestions.length,
  };
}

export function formatLintSuggestions(result) {
  const lines = [
    '# 知识修复建议',
    '',
    `> 生成时间：${result.generatedAt}`,
    '> 本报告只给出建议，不会自动修改正文。',
    '',
    `共 ${result.issueCount} 条建议。`,
    '',
  ];

  if (result.suggestions.length === 0) {
    lines.push('## 结果', '', '- 无需修复建议。', '');
    return lines.join('\n');
  }

  lines.push('| 类型 | 路径 | 建议 | 说明 |', '|---|---|---|---|');
  result.suggestions.forEach((item) => {
    lines.push(`| \`${item.type}\` | \`${item.path}\` | ${item.action} | ${item.detail || '-'} |`);
  });

  return `${lines.join('\n')}\n`;
}

function parseArgs(args) {
  return {
    fixSuggestions: args.includes('--fix-suggestions'),
    json: args.includes('--json'),
    failOnIssues: args.includes('--fail-on-issues'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp() {
  console.log(`
知识 lint 工具

使用方法:
  bun run knowledge:lint -- --fix-suggestions
  bun run knowledge:lint -- --fix-suggestions --json
  bun run knowledge:lint -- --fix-suggestions --fail-on-issues

说明:
  当前版本只输出修复建议，不自动修改正文。
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.fixSuggestions) {
    throw new Error('当前仅支持 --fix-suggestions 模式，避免误以为工具会自动修复。');
  }

  const result = await runKnowledgeLint({
    rootDir: process.cwd(),
    fixSuggestions: options.fixSuggestions,
  });

  console.log(options.json ? JSON.stringify(result, null, 2) : formatLintSuggestions(result));

  if (options.failOnIssues && result.issueCount > 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ 知识 lint 失败: ${error.message}`);
    process.exit(1);
  });
}
