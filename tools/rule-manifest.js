#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function titleFromRuleFile(path) {
  return basename(path, '.md');
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function firstMeaningfulLine(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('---') && !line.startsWith('#') && !line.startsWith('|')) || '';
}

function ownerFor(enforcement) {
  if (enforcement.startsWith('code_')) return 'code';
  if (enforcement === 'indexed_reference') return 'model_with_resolver';
  return 'model';
}

function riskFor(enforcement, quick) {
  if (quick || enforcement === 'code_enforced') return 'high';
  if (enforcement === 'code_audited' || enforcement === 'model_semantic') return 'medium';
  return 'low';
}

function scoreFor(rule, content) {
  if (Number.isInteger(rule.score)) return rule.score;
  const match = content.match(/重要性评分：\s*(\d{1,3})\/100/);
  if (!match) return '';
  const score = Number(match[1]);
  return score >= 0 && score <= 100 ? score : '';
}

function triggerFor(rule) {
  if (rule.quick) return 'quick_audit';
  if (rule.tool) return 'full_audit';
  if (rule.enforcement === 'model_semantic') return 'semantic_task';
  if (rule.enforcement === 'model_checklist') return 'manual_checklist';
  return 'on_demand_resolver';
}

function boundaryFor(enforcement) {
  if (enforcement === 'code_enforced') return '代码可阻断确定违规；例外由模型记录理由';
  if (enforcement === 'code_audited') return '代码只报告问题；是否修复由模型结合任务判断';
  if (enforcement === 'model_semantic') return '内容和取舍必须由模型提炼，代码不得机械抽取';
  if (enforcement === 'model_checklist') return '模型按清单自查，代码不替代语义判断';
  return '按需检索参考，不常驻启动上下文';
}

function tagsFor(rule) {
  return [...new Set([
    rule.id,
    titleFromRuleFile(rule.ruleFile),
    rule.enforcement,
    rule.quick ? 'quick' : 'full',
  ])].join(', ');
}

function enrichRule(rule, rootDir) {
  const content = readText(join(rootDir, rule.ruleFile));
  return {
    ...rule,
    owner: ownerFor(rule.enforcement),
    risk: riskFor(rule.enforcement, rule.quick),
    score: scoreFor(rule, content),
    trigger: triggerFor(rule),
    boundary: boundaryFor(rule.enforcement),
    sourceExcerpt: firstMeaningfulLine(content),
    tags: tagsFor(rule),
  };
}

function tableCell(value) {
  return String(value || '-').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function classifyUncoveredRule(ruleFile) {
  const modelSemanticNames = [
    '实时对话记录规范',
    '偏好本地化规范',
    '方向盘协作规范',
    '模糊矛盾处理规范',
    '问题修复规范',
    '规划模式规范',
    '执行模式规范',
    'STARTT文档规范',
  ];

  const name = titleFromRuleFile(ruleFile);
  if (modelSemanticNames.includes(name)) {
    return 'model_semantic';
  }

  return 'indexed_reference';
}

export async function buildRuleManifest({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const configPath = join(rootDir, 'tools', 'rule-auditor-config.json');
  const config = existsSync(configPath) ? readJson(configPath) : { auditors: [], checklists: [] };
  const ruleFiles = await glob('00_DIM/rules/*.md', { cwd: rootDir, nodir: true });
  const rules = [];
  const seen = new Set();

  function addRule(rule) {
    const key = `${rule.id}:${rule.ruleFile}`;
    if (seen.has(key)) return;
    seen.add(key);
    rules.push(rule);
  }

  (config.auditors || []).forEach((auditor) => {
    addRule({
      id: auditor.id,
      name: auditor.name,
      ruleFile: auditor.ruleFile,
      enforcement: auditor.quick ? 'code_enforced' : 'code_audited',
      tool: auditor.module,
      quick: Boolean(auditor.quick),
    });
  });

  (config.checklists || []).forEach((checklist) => {
    addRule({
      id: checklist.id,
      name: checklist.name,
      ruleFile: checklist.ruleFile,
      enforcement: 'model_checklist',
      tool: '',
      quick: false,
    });
  });

  ruleFiles.sort().forEach((ruleFile) => {
    const alreadyCovered = rules.some((rule) => rule.ruleFile === ruleFile);
    if (!alreadyCovered) {
      addRule({
        id: basename(ruleFile, '.md'),
        name: titleFromRuleFile(ruleFile),
        ruleFile,
        enforcement: classifyUncoveredRule(ruleFile),
        tool: '',
        quick: false,
      });
    }
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    rules: rules
      .map((rule) => enrichRule(rule, rootDir))
      .sort((a, b) => a.ruleFile.localeCompare(b.ruleFile) || a.id.localeCompare(b.id)),
  };

  return manifest;
}

export function formatRuleManifest(manifest) {
  const lines = [
    '---',
    '层级: DIM',
    '类型: 规则执行清单',
    `generated: ${manifest.generatedAt}`,
    '---',
    '',
    '# 规则执行清单',
    '',
    '> 本文件由 `bun run rules:manifest` 生成，用于连接 Markdown 规则、审计器、执行器和模型判断边界。',
    '',
    '| ID | 规则文件 | 执行层级 | Owner | Risk | Score | Trigger | 工具 | Boundary | Source excerpt | Tags | Quick |',
    '|---|---|---|---|---|---:|---|---|---|---|---|---:|',
  ];

  manifest.rules.forEach((rule) => {
    lines.push([
      `| \`${tableCell(rule.id)}\``,
      `\`${tableCell(rule.ruleFile)}\``,
      tableCell(rule.enforcement),
      tableCell(rule.owner),
      tableCell(rule.risk),
      tableCell(rule.score),
      tableCell(rule.trigger),
      rule.tool ? `\`${tableCell(rule.tool)}\`` : '-',
      tableCell(rule.boundary),
      tableCell(rule.sourceExcerpt),
      tableCell(rule.tags),
      rule.quick ? '是' : '否',
      '|',
    ].join(' | '));
  });

  return `${lines.join('\n')}\n`;
}

export async function writeRuleManifest({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const manifest = await buildRuleManifest({ rootDir });
  const path = '00_DIM/RULE_MANIFEST.md';
  const fullPath = join(rootDir, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, formatRuleManifest(manifest), 'utf8');
  return { path, count: manifest.rules.length };
}

function parseArgs(args) {
  return {
    write: args.includes('--write'),
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp() {
  console.log(`
规则执行清单生成器

使用方法:
  bun run rules:manifest
  bun run rules:manifest -- --write
  bun run rules:manifest -- --json
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.write) {
    const result = await writeRuleManifest({ rootDir: process.cwd() });
    console.log(options.json ? JSON.stringify(result, null, 2) : `✅ 已生成 ${result.path}`);
    return;
  }
  const manifest = await buildRuleManifest({ rootDir: process.cwd() });
  console.log(options.json ? JSON.stringify(manifest, null, 2) : formatRuleManifest(manifest));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ 规则执行清单生成失败: ${error.message}`);
    process.exit(1);
  });
}
