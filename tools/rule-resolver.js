#!/usr/bin/env bun

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { buildRuleManifest } from './rule-manifest.js';

function tokenize(query) {
  const baseTokens = String(query || '')
    .toLowerCase()
    .split(/[\s,，。:：;；/\\|]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const expanded = new Set(baseTokens);
  for (const token of baseTokens) {
    if (!/[\u4e00-\u9fff]/.test(token)) continue;
    for (let size = 2; size <= 4; size++) {
      for (let i = 0; i <= token.length - size; i++) {
        expanded.add(token.slice(i, i + size));
      }
    }
  }

  return [...expanded];
}

function firstMeaningfulLine(content, tokens = []) {
  const lines = content
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith('---') && !item.startsWith('#'));

  const matchingLine = lines.find((line) =>
    tokens.some((token) => token.length >= 2 && line.toLowerCase().includes(token.toLowerCase()))
  );

  return matchingLine || lines[0] || '';
}

function scoreRule(rule, content, tokens) {
  const haystack = [
    rule.id,
    rule.name,
    rule.ruleFile,
    rule.enforcement,
    rule.owner,
    rule.risk,
    rule.trigger,
    rule.boundary,
    rule.sourceExcerpt,
    rule.tags,
    content,
  ].join(' ').toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token.toLowerCase()) ? 1 : 0), 0);
}

export async function resolveRules({ rootDir = process.cwd(), query, limit = 5 } = {}) {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    throw new Error('缺少规则查询词');
  }

  const manifest = await buildRuleManifest({ rootDir });
  const matches = [];

  for (const rule of manifest.rules) {
    const fullPath = join(rootDir, rule.ruleFile);
    const content = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : '';
    const score = scoreRule(rule, content, tokens);
    if (score === 0) continue;

    matches.push({
      ...rule,
      score,
      summary: firstMeaningfulLine(content, tokens) || rule.sourceExcerpt,
    });
  }

  matches.sort((a, b) => b.score - a.score || a.ruleFile.localeCompare(b.ruleFile));

  return {
    query,
    matches: matches.slice(0, limit),
  };
}

function parseArgs(args) {
  const queryIndex = args.findIndex((arg) => arg === '--query' || arg === '-q');
  const limitIndex = args.findIndex((arg) => arg === '--limit');
  return {
    query: queryIndex >= 0 ? args[queryIndex + 1] : args.filter((arg) => !arg.startsWith('--')).join(' '),
    limit: limitIndex >= 0 ? Number(args[limitIndex + 1]) : 5,
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function formatResult(result) {
  const lines = [
    '# 规则 Resolver 结果',
    '',
    `> 查询：${result.query}`,
    '',
  ];

  if (result.matches.length === 0) {
    lines.push('- 未找到候选规则。');
    return `${lines.join('\n')}\n`;
  }

  lines.push('| 规则 | 执行层级 | Owner | Risk | Trigger | 工具 | 摘要 |', '|---|---|---|---|---|---|---|');
  for (const match of result.matches) {
    lines.push(`| \`${match.ruleFile}\` | ${match.enforcement} | ${match.owner || '-'} | ${match.risk || '-'} | ${match.trigger || '-'} | ${match.tool ? `\`${match.tool}\`` : '-'} | ${match.summary || '-'} |`);
  }
  return `${lines.join('\n')}\n`;
}

function printHelp() {
  console.log(`
规则 Resolver

使用方法:
  bun run rules:resolve -- --query "断点续传"
  bun run rules:resolve -- --query "ODS 禁止修改" --json

说明:
  Resolver 只返回候选规则和执行层级，不替大模型做语义判断。
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await resolveRules({
    rootDir: process.cwd(),
    query: options.query,
    limit: options.limit,
  });
  console.log(options.json ? JSON.stringify(result, null, 2) : formatResult(result));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ 规则 Resolver 失败: ${error.message}`);
    process.exit(1);
  });
}
