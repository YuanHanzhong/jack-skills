#!/usr/bin/env bun

/**
 * 向量记忆系统初始化工具（SQLite + 阿里云百炼）
 *
 * 核心逻辑：
 * 1. 检测 DASHSCOPE_API_KEY 环境变量
 * 2. 创建 .memory 目录
 * 3. 执行首次向量索引（vec-index.js）
 *
 * 使用：
 *   bun run memory:init              # 完整初始化（自动检测 + 索引）
 *   bun run memory:init --check      # 仅检测环境
 *   bun run memory:init --index      # 仅执行索引
 */

import 'dotenv/config';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Database } from 'bun:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// 颜色
const c = {
  g: (t) => `\x1b[32m${t}\x1b[0m`,
  r: (t) => `\x1b[31m${t}\x1b[0m`,
  y: (t) => `\x1b[33m${t}\x1b[0m`,
  cy: (t) => `\x1b[36m${t}\x1b[0m`,
  b: (t) => `\x1b[1m${t}\x1b[0m`,
  d: (t) => `\x1b[90m${t}\x1b[0m`,
};

// 参数
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const indexOnly = args.includes('--index');

// ===========================================
// 检测函数
// ===========================================

/**
 * 检测 DASHSCOPE_API_KEY 环境变量
 */
function checkDashScopeApiKey() {
  console.log(c.b('\n🔑 检测 DashScope API Key...\n'));

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (apiKey) {
    const masked = apiKey.slice(0, 6) + '...' + apiKey.slice(-4);
    console.log(c.g(`  ✅ DASHSCOPE_API_KEY 已配置 (${masked})`));
    return true;
  }

  console.log(c.y('  ⚠️  DASHSCOPE_API_KEY 未配置'));
  console.log(c.y('  Embedding 将降级为 null 模式（无向量搜索）'));
  console.log(c.cy('  配置方法: 在 .env 文件中添加 DASHSCOPE_API_KEY=your_key'));
  return false;
}

/**
 * 确保 .memory 目录存在
 */
function ensureMemsearchDir() {
  const memsearchDir = join(rootDir, '.memory');
  const memoryDir = join(memsearchDir, 'memory');

  if (!existsSync(memsearchDir)) {
    mkdirSync(memsearchDir, { recursive: true });
    console.log(c.g('  ✅ 创建 .memory/ 目录'));
  }

  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    console.log(c.g('  ✅ 创建 .memory/memory/ 目录'));
  }
}

/**
 * 执行向量索引
 */
function runIndex() {
  console.log(c.b('\n📊 执行向量索引（vec-index.js）...\n'));

  const vecIndexScript = join(rootDir, 'tools', 'vec-index.js');
  if (!existsSync(vecIndexScript)) {
    console.log(c.r('  ❌ vec-index.js 不存在'));
    return false;
  }

  console.log(c.d('  ⏳ 首次索引可能需要 1-10 分钟...\n'));

  const result = spawnSync('bun', [vecIndexScript], {
    cwd: rootDir,
    encoding: 'utf-8',
    timeout: 600000, // 10 分钟
    stdio: 'inherit',
  });

  if (result.status === 0) {
    console.log(c.g('\n  ✅ 向量索引完成'));
    return true;
  }

  console.log(c.r(`\n  ❌ 索引失败 (exit: ${result.status})`));
  return false;
}

/**
 * 显示索引统计
 */
function showStats() {
  const dbPath = join(rootDir, '.memory', 'vectors.db');
  if (!existsSync(dbPath)) {
    console.log(c.y('\n  vectors.db 不存在，无法显示统计'));
    return;
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db.query('SELECT COUNT(*) as n FROM chunks').get();
    db.close();
    console.log(c.b(`\n📈 统计: ${row?.n ?? 0} 个向量块`));
  } catch (e) {
    console.log(c.y(`\n  统计读取失败: ${e.message}`));
  }
}

// ===========================================
// 主流程
// ===========================================

async function main() {
  console.log(c.b('🧠 向量记忆系统初始化（SQLite + 阿里云百炼）'));
  console.log('═'.repeat(50));

  // Step 1: 检测 DashScope API Key
  const hasApiKey = checkDashScopeApiKey();

  // Step 2: 目录
  console.log(c.b('\n📁 检测目录...\n'));
  ensureMemsearchDir();

  const dbPath = join(rootDir, '.memory', 'vectors.db');
  if (existsSync(dbPath)) {
    console.log(c.g('  ✅ vectors.db 已存在'));
  } else {
    console.log(c.y('  ⚠️  vectors.db 不存在（需要建立索引）'));
  }

  if (checkOnly) {
    console.log(c.b('\n📋 环境总结:\n'));
    console.log(`  DashScope API:  ${hasApiKey ? '✅' : '⚠️  未配置'}`);
    console.log(`  vectors.db:     ${existsSync(dbPath) ? '✅' : '❌'}`);
    console.log('');
    process.exit(0);
  }

  // Step 3: 索引
  if (indexOnly || !checkOnly) {
    const ok = runIndex();
    if (ok) showStats();
  }

  // Step 4: 完成
  console.log(c.b('\n✅ 初始化完成\n'));
  console.log('日常使用:');
  console.log(c.cy('  bun run memory:search "查询内容"    # 向量语义搜索'));
  console.log(c.cy('  bun run memory:search "查询" --top-k 10  # 指定结果数量'));
  console.log(c.cy('  bun run memory:watch                 # 文件监听自动索引'));
  console.log(c.cy('  bun run memory:index                 # 全量/增量建立索引'));
  console.log('');
}

main().catch((e) => {
  console.error(c.r(`初始化失败: ${e.message}`));
  process.exit(1);
});
