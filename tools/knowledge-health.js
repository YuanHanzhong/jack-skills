#!/usr/bin/env bun

import { analyzeKnowledgeHealth, formatKnowledgeHealthReport } from './knowledge-health-core.js';

function parseArgs(args) {
  return {
    json: args.includes('--json'),
    failOnIssues: args.includes('--fail-on-issues'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp() {
  console.log(`
知识健康检查工具

使用方法:
  bun run knowledge:health
  bun run knowledge:health --json
  bun run knowledge:health --fail-on-issues

检查范围:
  - ODS/DWD/DWS/ADS Markdown 数量
  - ODS sha256 漂移
  - DWD/DWS confidence、contested、sources 信号
  - DWD/DWS wikilink 孤岛与断链
  - 双层页面、分钟级时间线、canonical_id、aliases、relations
  - ADS 三件套、方向盘 ADS 链接、原始证据引用
`);
}

function issueCount(report) {
  return (
    report.odsHash.drifted.length +
    report.quality.lowConfidence.length +
    report.quality.contested.length +
    report.links.orphans.length +
    report.links.broken.length +
    report.structure.missingCurrentConclusion.length +
    report.structure.invalidTimeline.length +
    report.metadata.duplicateAliases.length +
    report.metadata.brokenRelations.length +
    report.evidence.brokenRefs.length +
    report.adsGroups.incomplete.length +
    report.direction.missingAdsLinks.length
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const report = await analyzeKnowledgeHealth({ rootDir: process.cwd() });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatKnowledgeHealthReport(report));
  }

  if (options.failOnIssues && issueCount(report) > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ 知识健康检查失败: ${error.message}`);
  process.exit(1);
});
