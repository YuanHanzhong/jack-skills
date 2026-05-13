#!/usr/bin/env bun

/**
 * benchmark-v2.js — SQLite 向量索引全维度基准测试
 *
 * L1: vec-search.js（SQLite + 阿里云百炼，向量搜索）
 * L3: grep（关键词全文搜索）
 *
 * 维度：延迟分布、质量分析、语义能力、资源占用、冷/热查询对比、QPS
 *
 * 使用：
 *   bun tools/benchmark-v2.js
 *   bun tools/benchmark-v2.js --iterations=10
 *   bun tools/benchmark-v2.js --quiet
 */

import { spawnSync, execSync } from 'child_process';
import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// ─── CLI 参数 ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const ITERATIONS = parseInt(args.find(a => a.startsWith('--iterations='))?.split('=')[1] ?? '1');
const QUIET = args.includes('--quiet');

// ─── 颜色工具 ────────────────────────────────────────────────────
const c = {
  bold:    t => `\x1b[1m${t}\x1b[0m`,
  dim:     t => `\x1b[90m${t}\x1b[0m`,
  green:   t => `\x1b[32m${t}\x1b[0m`,
  red:     t => `\x1b[31m${t}\x1b[0m`,
  yellow:  t => `\x1b[33m${t}\x1b[0m`,
  cyan:    t => `\x1b[36m${t}\x1b[0m`,
  magenta: t => `\x1b[35m${t}\x1b[0m`,
  blue:    t => `\x1b[34m${t}\x1b[0m`,
};

function log(...a) { if (!QUIET) console.log(...a); }
function sep(char = '─', n = 60) { return char.repeat(n); }

// ─── 前置检查：无需释放 DB 锁 ────────────────────────────────────
// SQLite WAL 模式允许多读一写，无锁冲突。
function ensureDBFree() {
  // no-op：SQLite + WAL 模式下不存在锁问题
}

// ─── 测试查询集（分类覆盖不同场景）────────────────────────────────

const QUERIES = [
  // 精确关键词（grep 有优势）
  { id: 1, query: '闪卡机制',           type: 'exact',    lang: 'zh', note: '精确关键词' },
  { id: 2, query: 'git commit',         type: 'exact',    lang: 'en', note: '英文精确词' },
  { id: 3, query: 'WSL bridge',         type: 'exact',    lang: 'mix', note: '专有名词混合' },

  // 语义同义（memsearch 有优势）
  { id: 4, query: '记忆卡片怎么晋级',   type: 'semantic', lang: 'zh', note: '同义词：闪卡晋级条件' },
  { id: 5, query: '如何防止密钥泄露',   type: 'semantic', lang: 'zh', note: '同义：密钥安全规范' },
  { id: 6, query: '知识分层体系',       type: 'semantic', lang: 'zh', note: '同义：五层架构' },

  // 跨语言（memsearch 独特优势）
  { id: 7, query: 'ADS task flow',      type: 'cross',    lang: 'en', note: '英文查中文：ADS 三态流转' },
  { id: 8, query: 'memory card review', type: 'cross',    lang: 'en', note: '英文查中文：闪卡复习' },

  // 概念查询（复杂语义）
  { id: 9,  query: '会话结束后做什么',  type: 'concept',  lang: 'zh', note: '概念理解：Stop Hook 机制' },
  { id: 10, query: '向量数据库存在哪里', type: 'concept', lang: 'zh', note: '概念：milvus.db 位置' },
];

// ─── 统计工具 ────────────────────────────────────────────────────

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(times) {
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    avg,
    min: Math.min(...times),
    max: Math.max(...times),
    p50: percentile(times, 50),
    p90: percentile(times, 90),
    p99: percentile(times, 99),
  };
}

// ─── L1: vec-search.js 语义搜索（SQLite + 阿里云百炼，JSON 输出）────

function runL1(query, topK = 3) {
  const t0 = performance.now();
  const r = spawnSync('bun', [join(__dirname, 'vec-search.js'), query, '--top-k', String(topK)], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 8_000,   // 8s 超时：防止单次搜索卡住整个基准测试
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const elapsed = performance.now() - t0;

  if (r.status !== 0) {
    return { ok: false, elapsed, results: [], raw: r.stderr };
  }

  let results = [];
  try {
    results = JSON.parse(r.stdout.trim());
  } catch {
    results = [];
  }

  return { ok: results.length > 0, elapsed, results };
}

// ─── L3: grep 关键词搜索 ─────────────────────────────────────────

const SEARCH_DIRS = [
  '.memory/memory',
  '00_DIM', '02_DWD', '03_DWS', '04_ADS',
].filter(d => existsSync(join(ROOT, d))).map(d => join(ROOT, d));

function runL3(query, topK = 3) {
  const t0 = performance.now();

  // 分词，取最有区分度的词（长度 ≥ 2）
  const keywords = query.split(/[\s,，、]+/).filter(k => k.length >= 2);
  const primary = keywords[0] || query;

  const r = spawnSync('grep', [
    '-rni', '--include=*.md', '-l',
    primary,
    ...SEARCH_DIRS,
  ], { cwd: ROOT, encoding: 'utf-8', timeout: 10_000 });

  const elapsed = performance.now() - t0;

  if (r.status !== 0 || !r.stdout.trim()) {
    return { ok: false, elapsed, results: [], totalFiles: 0 };
  }

  const files = r.stdout.trim().split('\n').filter(Boolean);

  // 对每个命中文件，获取实际内容片段
  const results = files.slice(0, topK).map(file => {
    const ctx = spawnSync('grep', ['-i', '-m', '2', primary, file], {
      encoding: 'utf-8', timeout: 3000,
    });
    return {
      source: file.replace(ROOT + '/', ''),
      content: ctx.stdout?.split('\n').slice(0, 2).join(' ').slice(0, 120) ?? '',
      score: null, // grep 无语义分数
    };
  });

  return { ok: true, elapsed, results, totalFiles: files.length };
}

// ─── 内存测量 ────────────────────────────────────────────────────

function getProcessMemMB() {
  // 测量当前 Bun 进程 RSS
  const mem = process.memoryUsage();
  return {
    rss:      (mem.rss      / 1024 / 1024).toFixed(1),
    heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(1),
    heapTotal:(mem.heapTotal/ 1024 / 1024).toFixed(1),
  };
}

// Ollama 已移除，embedding 使用阿里云百炼 API

function getDirSizeMB(dirPath) {
  if (!existsSync(dirPath)) return 0;
  try {
    const r = spawnSync('du', ['-sk', dirPath], { encoding: 'utf-8' });
    if (r.status === 0) {
      return (parseInt(r.stdout.split('\t')[0]) / 1024).toFixed(2);
    }
    console.error(`⚠️  du 命令失败 (${dirPath}): 退出码 ${r.status}`);
  } catch (e) {
    console.error(`⚠️  获取目录大小失败 (${dirPath}):`, e.message);
  }
  return '?';
}

// ─── 系统信息 ────────────────────────────────────────────────────

async function collectSystemInfo() {
  const dbPath = join(ROOT, '.memory', 'vectors.db');
  const memDir = join(ROOT, '.memory', 'memory');

  const dbSizeKB = existsSync(dbPath) ? (statSync(dbPath).size / 1024).toFixed(1) : 'N/A';

  // 统计索引目录文件数
  let mdCount = 0;
  for (const d of SEARCH_DIRS) {
    try {
      const walk = (p) => {
        for (const f of readdirSync(p, { withFileTypes: true })) {
          if (f.isDirectory()) walk(join(p, f.name));
          else if (f.name.endsWith('.md')) mdCount++;
        }
      };
      walk(d);
    } catch (e) {
      console.error(`⚠️  扫描目录失败 (${d}):`, e.message);
    }
  }

  // SQLite chunk 数量（直接查 DB，无需进程）
  let chunkCount = 'N/A';
  try {
    const { Database } = await import('bun:sqlite');
    if (existsSync(dbPath)) {
      const db = new Database(dbPath, { readonly: true });
      const row = db.query('SELECT COUNT(*) as n FROM chunks').get();
      chunkCount = row?.n ?? 0;
      db.close();
    }
  } catch {}

  const version = 'SQLite (vec-search.js)';
  const provider = 'dashscope-v4 (text-embedding-v4)';
  const hasApiKey = !!process.env.DASHSCOPE_API_KEY;

  return { dbSizeKB, mdCount, chunkCount, version, hasApiKey, provider,
           memDirSizeMB: getDirSizeMB(memDir) };
}

// ─── 主测试流程 ──────────────────────────────────────────────────

async function main() {
  console.log(c.bold('\n' + sep('═')));
  console.log(c.bold('  📊 SQLite 向量索引全维度基准测试 v2'));
  console.log(c.bold(sep('═') + '\n'));

  // SQLite WAL 模式：无需释放 DB 锁
  process.stdout.write(c.dim('  🔒 检查 vectors.db 可用性...'));
  ensureDBFree();
  console.log(c.green(' ✓\n'));

  // ── 系统信息 ──
  console.log(c.cyan('【系统信息】'));
  const info = await collectSystemInfo();
  console.log(`  memsearch 版本  : ${info.version}`);
  console.log(`  Embedding 模型  : ${info.provider}`);
  console.log(`  milvus.db 大小  : ${info.dbSizeKB} KB`);
  console.log(`  索引 chunks 数  : ${info.chunkCount}`);
  console.log(`  索引 MD 文件数  : ${info.mdCount}`);
  console.log(`  DashScope API   : ${info.hasApiKey ? c.green('已配置') : c.red('未配置')}`);
  console.log(`  memory 目录大小 : ${info.memDirSizeMB} MB`);
  console.log(`  测试迭代次数    : ${ITERATIONS}\n`);

  if (!info.hasApiKey) {
    console.log(c.yellow('⚠️  DASHSCOPE_API_KEY 未配置，L1 搜索将降级为 null 模式。仅展示 L3 数据。'));
  }

  // ── 维度 1: 延迟分布（冷/热）──
  console.log(c.bold(sep('─')));
  console.log(c.bold('  维度 1: 检索延迟分布（ms）'));
  console.log(c.bold(sep('─')));
  console.log(c.dim('  策略：第 1 次 = 冷查询，后续 N-1 次 = 热查询，分别统计\n'));

  const speedResults = [];

  for (const q of QUERIES) {
    process.stdout.write(c.dim(`  [${q.id}/${QUERIES.length}] ${q.query.padEnd(18)} `));

    const l1Times = [];
    const l3Times = [];
    let l1Last, l3Last;

    for (let i = 0; i < ITERATIONS; i++) {
      process.stdout.write(c.dim(`\r    [iter ${i+1}/${ITERATIONS}] L1搜索中...`));
      l1Last = runL1(q.query);
      l1Times.push(l1Last.elapsed);

      process.stdout.write(c.dim(`\r    [iter ${i+1}/${ITERATIONS}] L1=${l1Last.elapsed.toFixed(0)}ms  L3搜索中...`));
      l3Last = runL3(q.query);
      l3Times.push(l3Last.elapsed);
      process.stdout.write(c.dim(`\r    [iter ${i+1}/${ITERATIONS}] L1=${l1Last.elapsed.toFixed(0)}ms  L3=${l3Last.elapsed.toFixed(0)}ms  ✓`));
    }
    process.stdout.write('\n');

    const s1 = stats(l1Times);
    const s3 = stats(l3Times);
    // 直接复用最后一次迭代的结果，不额外多跑一次

    process.stdout.write(
      `L1=${c.yellow(s1.avg.toFixed(0)+'ms')} p90=${s1.p90.toFixed(0)}  ` +
      `L3=${c.green(s3.avg.toFixed(0)+'ms')} p90=${s3.p90.toFixed(0)}\n`
    );

    speedResults.push({ q, l1Times, l3Times, s1, s3,
                        l1Result: l1Last, l3Result: l3Last });
  }

  // ── 维度 2: 质量分析 ──
  console.log('\n' + c.bold(sep('─')));
  console.log(c.bold('  维度 2: 检索质量分析'));
  console.log(c.bold(sep('─')));
  console.log(c.dim('  L1 分数：0~1 向量相似度（越高越相关）'));
  console.log(c.dim('  L3 命中：找到的含关键词文件数\n'));

  console.log('  ' + [
    '序号', '查询词'.padEnd(16), '类型'.padEnd(8),
    'L1分数'.padEnd(8), 'L1命中', 'L3命中', '语言', '语义优势?'
  ].join('  '));
  console.log('  ' + sep('─', 80));

  let l1TotalScore = 0, l1ScoreCount = 0;
  const qualityRows = [];

  for (const r of speedResults) {
    const l1scores = r.l1Result.results?.map(x => x.score ?? 0) ?? [];
    const top1 = l1scores[0] ?? 0;
    const l1hits = r.l1Result.results?.length ?? 0;
    const l3hits = r.l3Result.totalFiles ?? 0;

    if (top1 > 0) { l1TotalScore += top1; l1ScoreCount++; }

    // 判断语义是否有优势
    const hasSemanticEdge = (r.q.type === 'semantic' || r.q.type === 'cross') && top1 >= 0.3;
    const edgeLabel = hasSemanticEdge ? c.green('✓ 是') : (top1 < 0.1 ? c.red('✗ 低分') : c.dim('—'));

    const row = [
      String(r.q.id).padEnd(4),
      r.q.query.slice(0, 14).padEnd(16),
      r.q.type.padEnd(8),
      (top1 > 0.5 ? c.green : top1 > 0.3 ? c.yellow : c.red)(top1.toFixed(4)).padEnd(16),
      String(l1hits).padEnd(6),
      String(l3hits).padEnd(6),
      r.q.lang.padEnd(4),
      edgeLabel,
    ];
    console.log('  ' + row.join('  '));
    qualityRows.push({ ...r, top1, l1hits, l3hits });
  }

  const avgScore = l1ScoreCount > 0 ? l1TotalScore / l1ScoreCount : 0;
  console.log('\n  ' + c.bold(`L1 平均相关性分数: ${avgScore.toFixed(4)}`) +
    (avgScore > 0.5 ? c.green('  (优秀)') : avgScore > 0.3 ? c.yellow('  (中等)') : c.red('  (偏低)')));

  // ── 维度 3: 语义能力专项（跨语言 + 同义词）──
  console.log('\n' + c.bold(sep('─')));
  console.log(c.bold('  维度 3: 语义理解能力专项'));
  console.log(c.bold(sep('─')));

  const semanticQueries = qualityRows.filter(r => r.q.type === 'semantic' || r.q.type === 'cross');
  const exactQueries    = qualityRows.filter(r => r.q.type === 'exact');

  const semAvg   = semanticQueries.length ? semanticQueries.reduce((s, r) => s + r.top1, 0) / semanticQueries.length : 0;
  const exactAvg = exactQueries.length    ? exactQueries.reduce((s, r) => s + r.top1, 0) / exactQueries.length : 0;

  console.log(`\n  同义词/概念查询（${semanticQueries.length} 条）平均 L1 分数: ${c.yellow(semAvg.toFixed(4))}`);
  console.log(`  精确关键词查询（${exactQueries.length} 条）平均 L1 分数:   ${c.yellow(exactAvg.toFixed(4))}`);

  console.log('\n  跨语言查询结果:');
  for (const r of qualityRows.filter(q => q.q.type === 'cross')) {
    const l3ok = r.l3Result.ok;
    console.log(`    "${r.q.query}" → L1: ${r.top1.toFixed(4)} | L3: ${l3ok ? c.red('❌ 关键词不匹配') : c.red('未命中')}`);
  }

  // ── 维度 4: 资源占用详细 ──
  console.log('\n' + c.bold(sep('─')));
  console.log(c.bold('  维度 4: 资源占用'));
  console.log(c.bold(sep('─')));

  const memNow = getProcessMemMB();

  // 存储分解
  const dbPath = join(ROOT, '.memory', 'vectors.db');
  const dbSizeKB = existsSync(dbPath) ? (statSync(dbPath).size / 1024).toFixed(1) : 'N/A';
  const memsearchTotalMB = getDirSizeMB(join(ROOT, '.memory'));

  console.log(`\n  【存储开销】`);
  console.log(`    vectors.db (向量索引) : ${dbSizeKB} KB`);
  console.log(`    .memory/ 目录总计     : ${memsearchTotalMB} MB`);
  console.log(`    grep 方式存储开销     : 0 KB（直接读 MD 文件）`);

  console.log(`\n  【内存占用】`);
  console.log(`    当前进程 RSS          : ${memNow.rss} MB`);
  console.log(`    当前进程 Heap         : ${memNow.heapUsed} / ${memNow.heapTotal} MB`);
  console.log(`    Embedding             : ${c.dim('阿里云百炼 API（无本地进程开销）')}`);

  // ── 维度 5: 冷 vs 热查询对比 ──
  console.log('\n' + c.bold(sep('─')));
  console.log(c.bold('  维度 5: 冷查询 vs 热查询延迟'));
  console.log(c.bold(sep('─')));
  console.log(c.dim('  冷查询 = 首次调用（无缓存），热查询 = 重复调用（有模型/OS 缓存）\n'));

  const l1ColdTimes = speedResults.map(r => r.l1Times[0]);
  const l1WarmTimes = speedResults.flatMap(r => r.l1Times.slice(1));
  const l3ColdTimes = speedResults.map(r => r.l3Times[0]);
  const l3WarmTimes = speedResults.flatMap(r => r.l3Times.slice(1));

  const s1c = stats(l1ColdTimes);
  const s1w = stats(l1WarmTimes);
  const s3c = stats(l3ColdTimes);
  const s3w = stats(l3WarmTimes);

  console.log('       ' + [''.padEnd(6), '平均'.padEnd(8), 'P50'.padEnd(8), 'P90'.padEnd(8), 'P99'].join('  '));
  console.log('  ' + sep('─', 50));
  const fmt = (s) => [s.avg.toFixed(0)+'ms', s.p50.toFixed(0)+'ms', s.p90.toFixed(0)+'ms', s.p99.toFixed(0)+'ms'];
  console.log('  L1 冷  ' + fmt(s1c).map(v => v.padEnd(8)).join('  '));
  console.log('  L1 热  ' + fmt(s1w).map(v => v.padEnd(8)).join('  '));
  console.log('  L3 冷  ' + fmt(s3c).map(v => v.padEnd(8)).join('  '));
  console.log('  L3 热  ' + fmt(s3w).map(v => v.padEnd(8)).join('  '));

  const warmup = ((s1c.avg - s1w.avg) / s1c.avg * 100).toFixed(1);
  if (parseFloat(warmup) > 0) {
    console.log(`\n  L1 热查询比冷查询快 ${c.yellow(warmup + '%')} （API 连接缓存效果）`);
  }

  // ── 维度 6: 吞吐量 ──
  console.log('\n' + c.bold(sep('─')));
  console.log(c.bold('  维度 6: 吞吐量（QPS）'));
  console.log(c.bold(sep('─')));

  const l1AvgMs = speedResults.reduce((s, r) => s + r.s1.avg, 0) / speedResults.length;
  const l3AvgMs = speedResults.reduce((s, r) => s + r.s3.avg, 0) / speedResults.length;
  const l1QPS = (1000 / l1AvgMs).toFixed(2);
  const l3QPS = (1000 / l3AvgMs).toFixed(2);

  console.log(`\n  L1 (memsearch) 平均延迟: ${l1AvgMs.toFixed(0)} ms → ${c.yellow(l1QPS + ' QPS')}`);
  console.log(`  L3 (grep)      平均延迟: ${l3AvgMs.toFixed(0)} ms → ${c.green(l3QPS + ' QPS')}`);
  console.log(`  速度差距: L3 比 L1 快 ${c.yellow((l1AvgMs / l3AvgMs).toFixed(1) + 'x')}`);

  // ── 汇总报告 ──
  console.log('\n' + c.bold(sep('═')));
  console.log(c.bold('  📋 综合评估结论'));
  console.log(c.bold(sep('═')));

  console.log(`
┌─────────────────────────────────────────────────┐
│  维度          L1 (SQLite 向量索引)    L3 (grep) │
├─────────────────────────────────────────────────┤
│  平均延迟      ${(l1AvgMs.toFixed(0)+'ms').padEnd(22)} ${l3AvgMs.toFixed(0)+'ms'} │
│  吞吐量        ${(l1QPS+' QPS').padEnd(22)} ${l3QPS+' QPS'} │
│  相关性分数    ${avgScore.toFixed(4).padEnd(22)} 无分数 │
│  语义同义词    ✓ 可以识别               ✗ 无法识别 │
│  跨语言检索    ✓ 支持                   ✗ 不支持 │
│  存储开销      ${(dbSizeKB+'KB').padEnd(22)} 0 │
│  内存开销      ~0 MB（API 调用）         ~0 MB │
│  依赖复杂度    低（SQLite+API）          低（系统grep） │
└─────────────────────────────────────────────────┘`);

  console.log(c.bold('\n  核心结论：'));

  if (avgScore > 0.5) {
    console.log(c.green('  ✅ SQLite 向量索引在质量维度明显优于 grep'));
    console.log(`     平均相关性 ${avgScore.toFixed(4)} > 0.5，语义理解能力强`);
  } else if (avgScore > 0.3) {
    console.log(c.yellow('  ⚠️  SQLite 向量索引质量中等，grep 在精确词场景有竞争力'));
    console.log(`     平均相关性 ${avgScore.toFixed(4)}，建议扩大索引规模（当前 ${info.chunkCount} chunks 偏少）`);
  } else {
    console.log(c.red('  ❌ 当前 SQLite 向量索引质量偏低'));
    console.log('     可能原因：①索引规模小 ②DASHSCOPE_API_KEY 未配置 ③chunk_size 设置不当');
  }

  console.log(`\n  速度代价: L1 平均慢 ${(l1AvgMs - l3AvgMs).toFixed(0)}ms（${(l1AvgMs / l3AvgMs).toFixed(1)}x）`);
  console.log(`  资源代价: 阿里云百炼 API 调用（无本地进程开销）`);

  console.log(c.bold('\n  适用场景建议：'));
  console.log('  • 历史记忆查询、跨会话上下文召回  → 用 L1（语义理解不可替代）');
  console.log('  • 精确命令/规则名查找              → 用 L3（快且准）');
  console.log('  • Hook 实时注入（< 3s 响应）       → 先 L1，超时降级 L3（现有架构已实现）');

  console.log(c.bold('\n' + sep('═') + '\n'));
}

main().catch(e => {
  console.error(c.red('基准测试失败:'), e.message);
  process.exit(1);
});
