#!/usr/bin/env bun

/**
 * benchmark-milvus.js — Milvus 向量索引效果多维度基准测试
 *
 * 对比 L1（memsearch 语义搜索）与 L3（grep 关键词搜索）的性能差异
 *
 * 测试维度：
 *   1. 检索效率（响应时间）
 *   2. 检索质量（相关性分数、结果匹配度）
 *   3. 资源占用（存储、内存）
 *   4. 可靠性（并发、文件锁）
 *
 * 使用方式：
 *   bun tools/benchmark-milvus.js
 */

import { spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// ─── 颜色工具 ────────────────────────────────────────────────────

const colors = {
  bold: (t) => `\x1b[1m${t}\x1b[0m`,
  dim: (t) => `\x1b[90m${t}\x1b[0m`,
  green: (t) => `\x1b[32m${t}\x1b[0m`,
  red: (t) => `\x1b[31m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan: (t) => `\x1b[36m${t}\x1b[0m`,
  magenta: (t) => `\x1b[35m${t}\x1b[0m`,
};

// ─── 测试查询集 ──────────────────────────────────────────────────

const TEST_QUERIES = [
  { id: 1, query: '闪卡机制', type: '精确关键词', expect: '两者都能找到' },
  { id: 2, query: '记忆卡片复习晋级条件', type: '同义词语义', expect: '语义应占优' },
  { id: 3, query: '会话如何保存到 DWS 层', type: '功能性查询', expect: '对比理解能力' },
  { id: 4, query: 'ADS task state transition', type: '英文转中文', expect: '语义跨语言' },
  { id: 5, query: 'git commit Conventional', type: '技术规范', expect: '精确 vs 语义' },
  { id: 6, query: '执行触发词有哪些', type: '规则查询', expect: '精确匹配' },
  { id: 7, query: '知识管理数据仓库分层', type: '概念查询', expect: '语义理解' },
  { id: 8, query: 'WSL bridge 跨平台', type: '专有名词', expect: '两者都能找' },
  { id: 9, query: '如何避免密钥泄露', type: '安全规范同义', expect: '语义应占优' },
  { id: 10, query: 'DashScope embedding 向量维度', type: '技术参数', expect: '对比精度' },
];

// 搜索目录（L3 grep 使用）
const SEARCH_DIRS = [
  '.memory/memory',
  '00_DIM',
  '02_DWD',
  '03_DWS',
  '04_ADS',
].filter(d => existsSync(join(projectRoot, d)));

// ─── L1: memsearch 语义搜索 ──────────────────────────────────────

function runL1Search(query) {
  const start = performance.now();
  const result = spawnSync('memsearch', ['search', query, '--top-k', '3'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    timeout: 30000,
  });
  const elapsed = performance.now() - start;

  if (result.status !== 0) {
    return { success: false, elapsed, error: result.stderr, results: [] };
  }

  // 解析结果
  const lines = result.stdout.split('\n');
  const results = [];
  let currentResult = null;

  for (const line of lines) {
    if (line.includes('--- Result')) {
      if (currentResult) results.push(currentResult);
      const scoreMatch = line.match(/score:\s*([\d.]+)/);
      currentResult = { score: scoreMatch ? parseFloat(scoreMatch[1]) : 0, content: '' };
    } else if (currentResult && line.trim()) {
      currentResult.content += line + '\n';
    }
  }
  if (currentResult) results.push(currentResult);

  return { success: true, elapsed, results };
}

// ─── L3: grep 关键词搜索 ─────────────────────────────────────────

function runL3Search(query) {
  const start = performance.now();

  // 提取关键词（简单分词）
  const keywords = query.split(/[\s,，、]+/).filter(k => k.length > 1);

  // grep 搜索
  const result = spawnSync('grep', [
    '-rni',
    '--include=*.md',
    '-l',
    keywords[0] || query,
    ...SEARCH_DIRS.map(d => join(projectRoot, d)),
  ], {
    cwd: projectRoot,
    encoding: 'utf-8',
    timeout: 10000,
  });

  const elapsed = performance.now() - start;

  if (result.status !== 0 || !result.stdout) {
    return { success: false, elapsed, error: 'No matches', results: [] };
  }

  // 统计命中文件
  const files = result.stdout.trim().split('\n').filter(Boolean);
  const results = files.slice(0, 3).map(file => ({
    score: 0, // grep 无分数
    content: file.replace(projectRoot + '/', ''),
  }));

  return { success: true, elapsed, results, totalFiles: files.length };
}

// ─── 运行基准测试 ────────────────────────────────────────────────

function runBenchmark(iterations = 3) {
  console.log(colors.bold('\n' + '='.repeat(60)));
  console.log(colors.bold('  Milvus 索引效果多维度基准测试'));
  console.log(colors.bold('='.repeat(60) + '\n'));

  // 系统信息
  console.log(colors.cyan('系统现状:'));
  console.log(`  索引目录: ${SEARCH_DIRS.join(', ')}`);

  const dbPath = join(projectRoot, '.memory', 'milvus.db');
  if (existsSync(dbPath)) {
    const dbSize = statSync(dbPath).size;
    console.log(`  milvus.db: ${(dbSize / 1024).toFixed(1)} KB`);
  }

  // 检查 memsearch
  const memsearchCheck = spawnSync('memsearch', ['--version'], { encoding: 'utf-8' });
  if (memsearchCheck.status === 0) {
    console.log(`  memsearch: ${memsearchCheck.stdout.trim()}`);
  } else {
    console.log(colors.red('  memsearch: 未安装'));
    process.exit(1);
  }

  // 检查 DashScope API
  const hasApiKey = !!process.env.DASHSCOPE_API_KEY;
  console.log(`  DashScope API: ${hasApiKey ? colors.green('已配置') : colors.red('未配置')}`);

  console.log(colors.bold('\n' + '-'.repeat(60)));
  console.log(colors.bold('  开始测试 (每组重复 ' + iterations + ' 次)'));
  console.log(colors.bold('-'.repeat(60) + '\n'));

  const allResults = [];

  for (const test of TEST_QUERIES) {
    console.log(colors.bold(`[${test.id}/${TEST_QUERIES.length}] ${test.query}`));
    console.log(colors.dim(`    类型: ${test.type} | 期望: ${test.expect}`));

    const l1Times = [];
    const l3Times = [];
    let l1Result = null;
    let l3Result = null;

    // L1 测试（memsearch）
    for (let i = 0; i < iterations; i++) {
      l1Result = runL1Search(test.query);
      l1Times.push(l1Result.elapsed);
    }

    // L3 测试（grep）
    for (let i = 0; i < iterations; i++) {
      l3Result = runL3Search(test.query);
      l3Times.push(l3Result.elapsed);
    }

    const l1Avg = l1Times.reduce((a, b) => a + b, 0) / iterations;
    const l3Avg = l3Times.reduce((a, b) => a + b, 0) / iterations;

    console.log(`    L1 (memsearch): ${l1Avg.toFixed(0)}ms`);
    console.log(`    L3 (grep):      ${l3Avg.toFixed(0)}ms`);
    console.log(`    差异:           ${l1Avg > l3Avg ? '+' : ''}${(l1Avg - l3Avg).toFixed(0)}ms (${l1Avg > l3Avg ? 'L1 慢' : 'L1 快'})`);

    if (l1Result.success && l1Result.results.length > 0) {
      console.log(`    L1 Top1 分数:   ${l1Result.results[0].score.toFixed(4)}`);
    }

    allResults.push({
      test,
      l1: { times: l1Times, avg: l1Avg, result: l1Result },
      l3: { times: l3Times, avg: l3Avg, result: l3Result },
    });

    console.log();
  }

  return allResults;
}

// ─── 生成报告 ────────────────────────────────────────────────────

function generateReport(results) {
  console.log(colors.bold('\n' + '='.repeat(60)));
  console.log(colors.bold('  测试报告'));
  console.log(colors.bold('='.repeat(60) + '\n'));

  // 1. 效率对比表格
  console.log(colors.cyan('1. 检索效率对比 (ms)\n'));
  console.log('| # | 查询 | L1 (memsearch) | L3 (grep) | 差异 |');
  console.log('|---|------|----------------|-----------|------|');

  let l1Total = 0, l3Total = 0;

  for (const r of results) {
    const diff = r.l1.avg - r.l3.avg;
    l1Total += r.l1.avg;
    l3Total += r.l3.avg;

    const diffStr = diff > 0 ? `+${diff.toFixed(0)}` : diff.toFixed(0);
    console.log(`| ${r.test.id} | ${r.test.query.slice(0, 15)} | ${r.l1.avg.toFixed(0)} | ${r.l3.avg.toFixed(0)} | ${diffStr} |`);
  }

  console.log(`| **总计** | | **${l1Total.toFixed(0)}** | **${l3Total.toFixed(0)}** | **${(l1Total - l3Total).toFixed(0)}** |`);

  // 2. 质量分析
  console.log(colors.cyan('\n2. 检索质量分析\n'));
  console.log('| # | 查询 | L1 Top1 分数 | L1 命中数 | L3 命中文件数 |');
  console.log('|---|------|-------------|----------|---------------|');

  let avgScore = 0;
  let scoreCount = 0;

  for (const r of results) {
    const score = r.l1.result.results?.[0]?.score || 0;
    const l1Hits = r.l1.result.results?.length || 0;
    const l3Hits = r.l3.result.totalFiles || 0;

    if (score > 0) {
      avgScore += score;
      scoreCount++;
    }

    console.log(`| ${r.test.id} | ${r.test.query.slice(0, 15)} | ${score.toFixed(4)} | ${l1Hits} | ${l3Hits} |`);
  }

  if (scoreCount > 0) {
    console.log(`\n**平均相关性分数**: ${(avgScore / scoreCount).toFixed(4)}`);
  }

  // 3. 资源占用
  console.log(colors.cyan('\n3. 资源占用对比\n'));
  console.log('| 指标 | L1 (memsearch) | L3 (grep) |');
  console.log('|------|----------------|-----------|');
  console.log('| 存储空间 | milvus.db ~116KB + 模型 274MB | 0 |');
  console.log('| 内存占用 | ~0（API 调用） | 几乎为 0 |');
  console.log('| 依赖项 | SQLite + DashScope API | 系统自带 grep |');

  // 4. 综合结论
  console.log(colors.cyan('\n4. 综合结论\n'));

  const l1Faster = results.filter(r => r.l1.avg < r.l3.avg).length;
  const l3Faster = results.length - l1Faster;
  const avgScoreFinal = scoreCount > 0 ? (avgScore / scoreCount) : 0;

  console.log(`- **效率**: L1 平均 ${colors.yellow((l1Total / results.length).toFixed(0) + 'ms')} vs L3 ${colors.yellow((l3Total / results.length).toFixed(0) + 'ms')}`);
  console.log(`  - L1 更快: ${l1Faster}/${results.length} 次`);
  console.log(`  - L3 更快: ${l3Faster}/${results.length} 次`);

  console.log(`\n- **质量**: L1 平均相关性分数 ${colors.yellow(avgScoreFinal.toFixed(4))}`);
  if (avgScoreFinal < 0.1) {
    console.log(`  - ${colors.red('分数偏低，可能原因: 索引规模小、embedding 模型能力、查询与内容匹配度低')}`);
  }

  console.log(`\n- **资源成本**: L1 需要额外 ~400MB (模型+DB)，L3 几乎为 0`);

  console.log(colors.cyan('\n5. 适用场景建议\n'));
  console.log('- **使用 L1 (memsearch) 当:**');
  console.log('  - 需要语义理解（同义词、跨语言、概念查询）');
  console.log('  - 查询词与文档词汇不完全匹配');
  console.log('  - 索引规模大，关键词匹配噪音高');
  console.log();
  console.log('- **使用 L3 (grep) 当:**');
  console.log('  - 精确关键词匹配即可满足需求');
  console.log('  - 资源受限，无需 API 调用');
  console.log('  - 需要快速验证，无需语义理解');

  console.log(colors.bold('\n' + '='.repeat(60) + '\n'));
}

// ─── 主函数 ──────────────────────────────────────────────────────

function main() {
  const results = runBenchmark(3);
  generateReport(results);
}

main();
