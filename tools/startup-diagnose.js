#!/usr/bin/env bun

/**
 * 启动诊断脚本 — 检测 7 项启动健康指标 + 自动修复
 *
 * 用法：
 *   bun tools/startup-diagnose.js            # 诊断模式（输出报告）
 *   bun tools/startup-diagnose.js --json     # JSON 输出
 *   bun tools/startup-diagnose.js --fix      # 诊断 + 自动修复
 *
 * 注册位置：.claude/settings.json → hooks.SessionEnd（--fix 模式）
 *
 * 7 项检测：
 *   1. vec-*.js 工具语法正确性
 *   2. startup-optimize.js 语法检查（无副作用）
 *   3. DashScope + vectors.db 可用性
 *   4. watch 进程存活
 *   5. session-status 缓存有效性
 *   6. bun-runner 缓存有效性
 *   7. Hook 数量统计
 */
//
// 触发时机：双层设计
//   层 1: SessionEnd hook → --fix 模式（静默修缓存，为下次启动预热）
//   层 2: /startup-optimize skill → 手动完整诊断 + 报告
//
// SessionEnd 执行顺序：diagnose --fix → cleanup（诊断时 vec-watch 仍存活）

import 'dotenv/config';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { Database } from 'bun:sqlite';

// ─── 路径常量 ────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PROJECT_ROOT  = join(__dirname, '..');
const MEMSEARCH_DIR = join(PROJECT_ROOT, '.memory');
const WATCH_PIDFILE    = join(MEMSEARCH_DIR, '.vec-watch.pid');
const SESSION_STATUS   = join(MEMSEARCH_DIR, '.session-status');
const MEMORY_DIR       = join(MEMSEARCH_DIR, 'memory');
const BUN_CACHE        = join(process.env.HOME || homedir(), '.claude', 'bun-path.cache');
const SETTINGS_FILE    = join(PROJECT_ROOT, '.claude', 'settings.json');

// 获取当前 bun 可执行文件路径（用于子进程调用，解决 PATH 缺失问题）
const BUN_EXE = process.argv[0];

// ─── 参数解析 ────────────────────────────────────────────────

const isFixMode = process.argv.includes('--fix');
const isJsonMode = process.argv.includes('--json');

// ─── 诊断结果收集 ────────────────────────────────────────────

const checks = [];
const suggestions = [];

function addCheck(name, status, detail) {
  checks.push({ name, status, detail });
}

// ─── 1. vec-*.js 工具语法检查 ──────────────────────────────

function checkVecTools() {
  const vecFiles = ['vec-index.js', 'vec-search.js', 'vec-watch.js'];
  for (const name of vecFiles) {
    const filePath = join(PROJECT_ROOT, 'tools', name);
    if (!existsSync(filePath)) {
      addCheck(`${name} 语法`, 'warn', '文件不存在');
      continue;
    }
    const result = spawnSync(BUN_EXE, ['--check', filePath], {
      encoding: 'utf-8',
      timeout: 5000,
      cwd: PROJECT_ROOT,
      env: { ...process.env, VEC_DRY_RUN: '1' },
    });
    if (result.status === 0) {
      addCheck(`${name} 语法`, 'pass', '解析正常');
    } else {
      const err = (result.stderr || '').slice(0, 200);
      addCheck(`${name} 语法`, 'fail', `解析错误: ${err}`);
      suggestions.push(`${name} 存在语法错误，需要手动修复`);
    }
  }
}

// ─── 2. startup-optimize.js 语法检查（无副作用） ─────────────
//
// 只验证语法可加载，不实际运行（运行会触发 watch 启动、session 标记等副作用）。
// 实际运行耗时由 SessionStart hook 负责，此处不测量。

function checkStartupOptimize() {
  const scriptPath = join(PROJECT_ROOT, 'tools', 'startup-optimize.js');
  if (!existsSync(scriptPath)) {
    addCheck('startup-optimize.js 语法', 'fail', '文件不存在');
    return;
  }

  const result = spawnSync(BUN_EXE, ['--check', scriptPath], {
    encoding: 'utf-8',
    timeout: 5000,
    cwd: PROJECT_ROOT,
  });

  if (result.status === 0) {
    addCheck('startup-optimize.js 语法', 'pass', '解析正常');
  } else {
    const err = (result.stderr || '').slice(0, 200);
    addCheck('startup-optimize.js 语法', 'fail', `解析错误: ${err}`);
    suggestions.push('startup-optimize.js 存在语法错误，需要手动修复');
  }
}

// ─── 3. DashScope + vectors.db 可用性 ───────────────────────────

function checkVecSystem() {
  // 3a. 检查 DashScope API Key
  const hasApiKey = !!process.env.DASHSCOPE_API_KEY;
  if (hasApiKey) {
    addCheck('DashScope API', 'pass', 'DASHSCOPE_API_KEY 已配置');
  } else {
    addCheck('DashScope API', 'warn', 'DASHSCOPE_API_KEY 未配置（向量搜索将降级为 null 模式）');
  }

  // 3b. 检查 vectors.db 是否存在且有数据
  const dbPath = join(MEMSEARCH_DIR, 'vectors.db');
  if (existsSync(dbPath)) {
    try {
      const db = new Database(dbPath, { readonly: true });
      const row = db.query('SELECT COUNT(*) as n FROM chunks').get();
      db.close();
      const count = row?.n ?? 0;
      if (count > 0) {
        addCheck('vectors.db 索引', 'pass', `${count} 个向量块`);
      } else {
        addCheck('vectors.db 索引', 'warn', '索引为空');
        suggestions.push('运行 bun run memory:index 建立向量索引');
      }
    } catch (e) {
      addCheck('vectors.db 索引', 'warn', `DB 读取失败: ${e.message}`);
    }
  } else {
    addCheck('vectors.db 索引', 'warn', 'vectors.db 不存在');
    suggestions.push('运行 bun run memory:index 建立向量索引');
  }
}

// ─── 4. watch 进程存活 ───────────────────────────────────────

function checkWatchProcess() {
  if (!existsSync(WATCH_PIDFILE)) {
    addCheck('watch 进程', 'warn', 'PID 文件不存在（下次 SessionStart 会自动启动）');
    return;
  }

  try {
    const pidStr = readFileSync(WATCH_PIDFILE, 'utf-8').trim();
    let alive = false;

    if (pidStr.startsWith('wsl:')) {
      const wslPid = pidStr.substring(4);
      const result = spawnSync('wsl', ['kill', '-0', wslPid], {
        timeout: 2000,
        windowsHide: true,
      });
      alive = result.status === 0;
    } else {
      const pid = parseInt(pidStr, 10);
      if (pid && !isNaN(pid)) {
        try { process.kill(pid, 0); alive = true; } catch { alive = false; }
      }
    }

    if (alive) {
      addCheck('watch 进程', 'pass', `PID ${pidStr} 存活`);
    } else {
      // SessionEnd 不重启 watch（--cleanup 马上会清理，下次 SessionStart 会重建）
      addCheck('watch 进程', 'warn', `PID ${pidStr} 已死亡（下次 SessionStart 会自动重启）`);
    }
  } catch (e) {
    addCheck('watch 进程', 'warn', `PID 文件读取失败: ${e.message}`);
  }
}

// ─── 5. session-status 缓存有效性 ───────────────────────────

function checkSessionStatus() {
  if (!existsSync(SESSION_STATUS)) {
    addCheck('session-status 缓存', 'warn', '缓存文件不存在');
    if (isFixMode) fixSessionStatus();
    return;
  }

  try {
    const cached = JSON.parse(readFileSync(SESSION_STATUS, 'utf-8'));
    const age = Date.now() - cached.ts;
    const ageMin = Math.round(age / 60000);

    if (age < 3600000) {
      addCheck('session-status 缓存', 'pass',
        `有效 (${ageMin}min, available=${cached.available})`);
    } else {
      addCheck('session-status 缓存', 'warn', `已过期 (${ageMin}min)`);
      if (isFixMode) fixSessionStatus();
    }
  } catch (e) {
    addCheck('session-status 缓存', 'warn', `缓存解析失败: ${e.message}`);
    if (isFixMode) fixSessionStatus();
  }
}

function fixSessionStatus() {
  try {
    const status = { available: false, hasIndex: false, ts: Date.now() };
    const dbPath = join(MEMSEARCH_DIR, 'vectors.db');

    if (existsSync(dbPath)) {
      try {
        const db = new Database(dbPath, { readonly: true });
        const row = db.query('SELECT COUNT(*) as n FROM chunks').get();
        db.close();
        status.available = true;
        status.hasIndex = (row?.n ?? 0) > 0;
      } catch (e) { console.error('⚠️  [fixSessionStatus] DB 读取失败:', e.message); }
    }

    writeFileSync(SESSION_STATUS, JSON.stringify(status), 'utf-8');
    suggestions.push('✅ 已刷新 session-status 缓存');
  } catch (e) {
    suggestions.push(`⚠️ session-status 刷新失败: ${e.message}`);
  }
}

// ─── 6. bun-runner 缓存 ─────────────────────────────────────

function checkBunCache() {
  if (!existsSync(BUN_CACHE)) {
    addCheck('bun-runner 缓存', 'warn', '缓存文件不存在');
    if (isFixMode) fixBunCache();
    return;
  }

  try {
    const bunPath = readFileSync(BUN_CACHE, 'utf-8').trim();
    if (bunPath && existsSync(bunPath)) {
      addCheck('bun-runner 缓存', 'pass', bunPath);
    } else {
      addCheck('bun-runner 缓存', 'warn', `缓存路径无效: ${bunPath}`);
      if (isFixMode) fixBunCache();
    }
  } catch (e) {
    addCheck('bun-runner 缓存', 'warn', `缓存读取失败: ${e.message}`);
    if (isFixMode) fixBunCache();
  }
}

function fixBunCache() {
  try {
    // 触发 bun-runner.sh 写入缓存
    const result = spawnSync('sh', [
      join(PROJECT_ROOT, 'tools', 'bun-runner.sh'), '--version',
    ], {
      encoding: 'utf-8',
      timeout: 5000,
    });

    if (result.status === 0 && existsSync(BUN_CACHE)) {
      suggestions.push('✅ 已重建 bun-runner 缓存');
    } else {
      suggestions.push('⚠️ bun-runner 缓存重建失败');
    }
  } catch (e) {
    suggestions.push(`⚠️ bun-runner 缓存重建失败: ${e.message}`);
  }
}

// ─── 7. Hook 数量统计 ────────────────────────────────────────

function checkHookCount() {
  if (!existsSync(SETTINGS_FILE)) {
    addCheck('Hook 统计', 'warn', 'settings.json 不存在');
    return;
  }

  try {
    const settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    const hooks = settings.hooks || {};
    const counts = {};
    let total = 0;

    for (const [event, matchers] of Object.entries(hooks)) {
      let count = 0;
      if (Array.isArray(matchers)) {
        for (const m of matchers) {
          count += (m.hooks || []).length;
        }
      }
      counts[event] = count;
      total += count;
    }

    const summary = Object.entries(counts)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    addCheck('Hook 统计', 'info', `${total} hooks (${summary})`);
  } catch (e) {
    addCheck('Hook 统计', 'warn', `settings.json 解析失败: ${e.message}`);
  }
}

// ─── 执行诊断 ────────────────────────────────────────────────

checkVecTools();
checkStartupOptimize();
checkVecSystem();
checkWatchProcess();
checkSessionStatus();
checkBunCache();
checkHookCount();

// ─── 输出结果 ────────────────────────────────────────────────

const report = {
  checks,
  suggestions,
  timestamp: new Date().toISOString(),
};

if (isJsonMode || isFixMode) {
  // JSON 输出到 stdout
  console.log(JSON.stringify(report, null, 2));
} else {
  // 人类可读摘要到 stderr（不干扰 hook 管道）
  const statusIcon = { pass: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️' };
  console.error('\n─── 启动诊断报告 ───────────────────────');
  for (const c of checks) {
    console.error(`  ${statusIcon[c.status] || '?'} ${c.name}: ${c.detail}`);
  }
  if (suggestions.length > 0) {
    console.error('\n  💡 建议:');
    for (const s of suggestions) {
      console.error(`     ${s}`);
    }
  }

  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  if (failCount === 0 && warnCount === 0) {
    console.error('\n  🎉 所有检测通过！');
  }
  console.error('────────────────────────────────────────\n');
}

// --fix 模式永远 exit 0（不阻塞 SessionEnd）
process.exit(0);
