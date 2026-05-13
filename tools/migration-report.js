#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { analyzeKnowledgeHealth } from './knowledge-health-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');

function shanghaiStamp(now = new Date()) {
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

function recommendation(priority, topic, count, action) {
  return { priority, topic, count, action };
}

export async function buildMigrationReport({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const health = await analyzeKnowledgeHealth({ rootDir });
  const summary = {
    odsMissingSha256: health.odsHash.missing.length,
    hashDrifted: health.odsHash.drifted.length,
    missingConfidence: health.quality.missingConfidence.length,
    missingSources: health.quality.missingSources.length,
    orphanPages: health.links.orphans.length,
    brokenLinks: health.links.broken.length,
    missingSchemas: health.schemas.missing.length,
    incompleteAdsGroups: health.adsGroups.incomplete.length,
    completedAdsWithoutDws: health.adsGroups.completedWithoutDws.length,
  };

  return {
    generatedAt: health.generatedAt,
    summary,
    samples: {
      odsMissingSha256: health.odsHash.missing.slice(0, 10),
      missingConfidence: health.quality.missingConfidence.slice(0, 10),
      missingSources: health.quality.missingSources.slice(0, 10),
      orphanPages: health.links.orphans.slice(0, 10),
      incompleteAdsGroups: health.adsGroups.incomplete.slice(0, 10),
    },
    recommendations: [
      recommendation('P0', 'ODS sha256 元数据', summary.odsMissingSha256, '生成可审查 patch，补齐 hash；不要手写，不改原文。'),
      recommendation('P1', '主题质量信号', summary.missingConfidence + summary.missingSources, '为主题型 DWD/DWS 补 confidence 和 sources。'),
      recommendation('P1', '孤岛页面', summary.orphanPages, '补充相关 DWD/DWS 链接，或归档不再使用的页面。'),
      recommendation('P2', 'ADS 结构债', summary.incompleteAdsGroups + summary.completedAdsWithoutDws, '补齐三件套或为已完成任务补 DWS 沉淀。'),
      recommendation('P2', '主题 Schema', summary.missingSchemas, '达到阈值的主题目录补 SCHEMA.md。'),
    ].filter((item) => item.count > 0),
  };
}

function listPaths(items, formatter = (item) => item.path) {
  if (!items.length) return '- 无';
  return items.map((item) => `- \`${formatter(item)}\``).join('\n');
}

export function formatMigrationReport(report) {
  const lines = [
    '---',
    '层级: DWS',
    '类型: 知识迁移报告',
    `generated: ${report.generatedAt}`,
    'tags: ["知识健康", "迁移报告", "Hermes机制"]',
    '---',
    '',
    '# 知识存量迁移报告',
    '',
    '## 当前结论',
    '',
    '本报告只汇总存量迁移债务和处理顺序，不自动修改 ODS/DWD/DWS/ADS 正文。',
    '',
    '## 债务统计',
    '',
    '| 项目 | 数量 |',
    '|---|---:|',
    `| ODS 缺 sha256 | ${report.summary.odsMissingSha256} |`,
    `| Hash 漂移 | ${report.summary.hashDrifted} |`,
    `| 缺 confidence | ${report.summary.missingConfidence} |`,
    `| 缺 sources | ${report.summary.missingSources} |`,
    `| 孤岛页面 | ${report.summary.orphanPages} |`,
    `| 断裂 wikilink | ${report.summary.brokenLinks} |`,
    `| 缺主题 SCHEMA | ${report.summary.missingSchemas} |`,
    `| ADS 三件套不完整 | ${report.summary.incompleteAdsGroups} |`,
    `| 已完成 ADS 缺 DWS 沉淀 | ${report.summary.completedAdsWithoutDws} |`,
    '',
    '## 推荐处理顺序',
    '',
    '| 优先级 | 主题 | 数量 | 建议 |',
    '|---|---|---:|---|',
    ...report.recommendations.map((item) => `| ${item.priority} | ${item.topic} | ${item.count} | ${item.action} |`),
    '',
    '## 样本清单',
    '',
    '### ODS 缺 sha256',
    '',
    listPaths(report.samples.odsMissingSha256),
    '',
    '### 缺 confidence',
    '',
    listPaths(report.samples.missingConfidence),
    '',
    '### 缺 sources',
    '',
    listPaths(report.samples.missingSources),
    '',
    '### 孤岛页面',
    '',
    listPaths(report.samples.orphanPages),
    '',
    '### ADS 三件套不完整',
    '',
    listPaths(report.samples.incompleteAdsGroups, (item) => `${item.key} 缺少 ${item.missingTypes.join(', ')}`),
    '',
  ];

  return lines.join('\n');
}

export async function writeMigrationReport({ rootDir = DEFAULT_ROOT_DIR, now = new Date() } = {}) {
  const report = await buildMigrationReport({ rootDir });
  const path = `03_DWS/insights/${shanghaiStamp(now)}-知识存量迁移报告.md`;
  const fullPath = join(rootDir, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, formatMigrationReport(report), 'utf8');
  return { path, summary: report.summary };
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
知识存量迁移报告器

使用方法:
  bun run migration:report
  bun run migration:report -- --write
  bun run migration:report -- --json

说明:
  默认输出 Markdown 报告到终端。
  使用 --write 写入 03_DWS/insights/YY-MMDD-HH-知识存量迁移报告.md。
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.write) {
    const result = await writeMigrationReport({ rootDir: process.cwd() });
    console.log(options.json ? JSON.stringify(result, null, 2) : `✅ 已生成 ${result.path}`);
    return;
  }
  const report = await buildMigrationReport({ rootDir: process.cwd() });
  console.log(options.json ? JSON.stringify(report, null, 2) : formatMigrationReport(report));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ 知识迁移报告失败: ${error.message}`);
    process.exit(1);
  });
}
