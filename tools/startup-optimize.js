#!/usr/bin/env bun

/**
 * 启动优化器 — SQLite 向量记忆系统的 SessionStart/End hooks
 *
 * ╭─────────────────────────────────────────────────────────────╮
 * │  设计目的                                                   │
 * │  ─────────                                                  │
 * │  管理 vec-watch.js 后台进程（文件监听 + 自动增量索引），    │
 * │  检查 vectors.db 健康状态，注入最近记忆上下文。             │
 * │  确保跨平台兼容（Linux / macOS / Windows）。                │
 * ╰─────────────────────────────────────────────────────────────╯
 *
 * 用法：
 *   bun tools/startup-optimize.js            # SessionStart：启动 watch + 注入记忆
 *   bun tools/startup-optimize.js --cleanup  # SessionEnd：停止 watch 进程
 *
 * 注册位置：.claude/settings.json → hooks.SessionStart / hooks.SessionEnd
 *
 * 相关 hooks：
 *   SessionStart  → 本脚本（主模式）
 *   SessionEnd    → 本脚本（--cleanup 模式）
 *   UserPromptSubmit → .claude/hooks/memory-inject.js（vec-search 语义搜索）
 *   Stop           → .claude/hooks/memory-save.js（vec-index 增量更新）
 */

import { spawnSync, spawn } from 'child_process';
import {
  existsSync, readFileSync, writeFileSync,
  mkdirSync, readdirSync, appendFileSync, unlinkSync,
} from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Database } from 'bun:sqlite';

// ─── 路径常量 ────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const MEMSEARCH_DIR = join(PROJECT_ROOT, '.memory');
const MEMORY_DIR = join(MEMSEARCH_DIR, 'memory');
const WATCH_PIDFILE = join(MEMSEARCH_DIR, '.vec-watch.pid');
const SESSION_STATUS = join(MEMSEARCH_DIR, '.session-status');
const MEMORY_CACHE = join(MEMSEARCH_DIR, '.memory-cache.json');

// ─── 向量系统说明 ─────────────────────────────────────────
// 使用 SQLite + 阿里云百炼 text-embedding-v4 向量搜索
// vec-watch.js: 文件监听 + 自动增量索引
// vec-search.js: 语义搜索
// vec-index.js: 全量/增量建立向量索引

// ─── Watch 进程管理 ──────────────────────────────────────────

/** 确保记忆目录存在 */
function ensureMemoryDir() {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

/**
 * 内部公共逻辑：通过 PID 文件 + pkill 兜底终止 vec-watch.js 进程，并清理 PID 文件。
 * stopWatch 和 killZombieWatch 共用此实现，避免重复代码。
 */
function _killWatchProcess() {
  // ── 1) PID 文件精确 kill ──
  if (existsSync(WATCH_PIDFILE)) {
    try {
      const pidStr = readFileSync(WATCH_PIDFILE, 'utf-8').trim();
      const pid = parseInt(pidStr, 10);
      if (pid && !isNaN(pid)) {
        try { process.kill(pid); } catch { /* 进程已退出 */ }
      }
    } catch { /* 读取失败 */ }
  }

  // ── 2) pkill 兜底：精确匹配项目路径下的 vec-watch.js 进程 ──
  // 注意：进程命令行为 "bun /project/tools/vec-watch.js"，项目路径在前，脚本名在后
  const vecWatchPath = join(__dirname, 'vec-watch.js');
  spawnSync('pkill', ['-9', '-f', vecWatchPath], {
    timeout: 3000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 等待 150ms 确保进程真正退出，避免新进程启动时旧进程仍占用资源
  Bun.sleepSync(150);

  // ── 3) 清理 PID 文件 ──
  try { unlinkSync(WATCH_PIDFILE); } catch { /* 文件不存在，忽略 */ }
}

/**
 * 停止 vec-watch 进程（SessionEnd 调用）：
 *   1) 通过 PID 文件精确 kill
 *   2) pkill -f "vec-watch.js" 兜底（清理孤儿/僵尸进程）
 */
function stopWatch() {
  _killWatchProcess();
}

/**
 * 清理所有僵尸 vec-watch.js 进程（SessionStart 防御性调用）。
 * 优先通过 PID 文件精确 kill，pkill 兜底时包含项目路径特征，
 * 避免误杀其他项目的 vec-watch.js 进程。
 */
function killZombieWatch() {
  _killWatchProcess();
}

/**
 * 检查 PID 文件对应的 vec-watch 进程是否仍然存活
 */
function isWatchAlive() {
  if (!existsSync(WATCH_PIDFILE)) return false;

  try {
    const pidStr = readFileSync(WATCH_PIDFILE, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);
    if (!pid || isNaN(pid)) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  } catch {
    return false;
  }
}

/**
 * 启动 vec-watch.js 单例进程。
 * 策略：进程存活则复用，否则 stop→start。
 * SQLite + WAL 模式无锁冲突，可安全常驻。
 */
function startWatch() {
  ensureMemoryDir();
  if (isWatchAlive()) return;  // 进程仍然存活，跳过重启
  stopWatch();

  const vecWatchScript = join(__dirname, 'vec-watch.js');
  let child;
  try {
    child = spawn('bun', [vecWatchScript], {
      detached: true,
      stdio: 'ignore',  // 守护进程标准模式：不持有父进程 stdio 引用
      cwd: PROJECT_ROOT,
      env: process.env,
    });
  } catch (e) {
    console.error(`❌ [vec-watch] 启动失败: ${e.message} (${e.code || 'unknown'})`);
    return;
  }
  // 监听 spawn 级别的异步错误（如可执行文件不存在、权限不足）
  // 注意：这只能捕获 spawn 失败，运行时错误由 vec-watch.js 自身记录
  child.on('error', (e) => {
    console.error(`❌ [vec-watch] spawn 错误: ${e.message} (code: ${e.code})`);
  });
  child.unref();
  if (child.pid) {
    try {
      writeFileSync(WATCH_PIDFILE, String(child.pid), 'utf-8');
    } catch (e) {
      console.error('❌ [vec-watch] PID 文件写入失败:', e.message);
    }
  } else {
    console.error('❌ [vec-watch] 启动失败：未获取到 PID');
  }
}

// ─── 记忆注入 ────────────────────────────────────────────────

/** 读取最近 2 天的记忆文件（各取最后 30 行） */
function getRecentMemories() {
  if (!existsSync(MEMORY_DIR)) return '';

  const files = readdirSync(MEMORY_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, 2);

  if (files.length === 0) return '';

  let context = '# Recent Memory\n\n';
  for (const f of files) {
    try {
      const lines = readFileSync(join(MEMORY_DIR, f), 'utf-8').split('\n');
      const last30 = lines.slice(-30).join('\n').trim();
      if (last30) {
        context += `## ${f}\n${last30}\n\n`;
      }
    } catch (e) {
      console.error(`❌ [记忆读取] 读取 ${f} 失败:`, e.message);
    }
  }

  return context;
}

// doSemanticSearch() 已移除 — UserPromptSubmit hook 已覆盖语义搜索，启动时无需重复

// ─── SQLite 索引健康检查 ──────────────────────────────────────

/**
 * 检查 vectors.db 是否存在且有数据，写入 .session-status 文件。
 * memory-inject.js 读取此文件做快速路径判断（但 vec-search.js 本身也会静默降级）。
 * 纯 SQLite 检查：即时完成，无需 spawn 进程或 API 调用。
 */
function checkMemsearchStatus() {
  const status = { available: false, hasIndex: false, ts: Date.now() };

  try {
    const dbPath = join(MEMSEARCH_DIR, 'vectors.db');
    if (existsSync(dbPath)) {
      const db = new Database(dbPath, { readonly: true });
      const row = db.query('SELECT COUNT(*) as n FROM chunks').get();
      db.close();
      status.available = true;
      status.hasIndex = (row?.n ?? 0) > 0;
    }
  } catch (e) {
    // DB 打开失败（格式错误等），记录错误但不阻塞启动
    console.error('❌ [vectors.db] 状态检查失败:', e.message);
  }

  writeFileSync(SESSION_STATUS, JSON.stringify(status), 'utf-8');
}

// ─── 入口 ────────────────────────────────────────────────────

const isCleanup = process.argv.includes('--cleanup');
const memoryHooksEnabled = process.env.KMS_ENABLE_MEMORY_HOOKS === '1';

if (isCleanup) {
  // ── SessionEnd 模式：清理 watch 进程 ──
  stopWatch();
  process.exit(0);
}

// 轻量化默认：不在 SessionStart 启动 watch、不注入最近记忆、不写缓存。
// 需要完整记忆系统时，显式设置 KMS_ENABLE_MEMORY_HOOKS=1。
if (!memoryHooksEnabled) {
  console.log('{}');
  process.exit(0);
}

// ── SessionStart 模式：启动优化 ──

// 0) 重置会话建档标记（供 session-archiver.js 检测首条消息）
const SESSION_ARCHIVE_MARKER = join(PROJECT_ROOT, '.claude', '.current-session-file');
try {
  if (existsSync(SESSION_ARCHIVE_MARKER)) {
    unlinkSync(SESSION_ARCHIVE_MARKER);
  }
} catch (e) {
  console.error('❌ [会话标记] 删除失败:', e.message);
}

// 1) 清理残留 watch 僵尸进程，然后启动新的 vec-watch.js 后台进程
killZombieWatch();
startWatch();

// 1.5) 检查 vectors.db 状态（供 memory-inject.js 读取）
// 纯文件操作，无进程 spawn，几乎零延迟
checkMemsearchStatus();

// 2) 确保今日记忆文件存在（不再写空 Session 头，内容由 Stop Hook 写入）
ensureMemoryDir();
const today = new Date().toISOString().split('T')[0];
const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const memoryFile = join(MEMORY_DIR, `${today}.md`);

if (!existsSync(memoryFile)) {
  writeFileSync(memoryFile, `# ${today} 记忆日志\n\n`, 'utf-8');
}
// 不追加空 ## Session 头 —— Stop Hook 负责在对话结束时写入 ### HH:MM + 实际内容

// 3) 收集记忆上下文（仅文件读取，语义搜索由 UserPromptSubmit hook 处理）
let context = getRecentMemories();

// 3.5) 预加载记忆到缓存文件（供其他 hook 快速读取）
try {
  writeFileSync(MEMORY_CACHE, JSON.stringify({ content: context, ts: Date.now() }), 'utf-8');
} catch (e) { console.error('⚠️  [记忆缓存] 写入失败:', e.message); }

// 4) 添加向量搜索工具说明
if (context.trim()) {
  context += '\n## Memory Tools\n';
  context += 'Use these commands for deeper context:\n';
  context += '- `bun run memory:search "查询内容"` — SQLite 向量语义搜索（需 DASHSCOPE_API_KEY）\n';
  context += '- `bun run memory:search "查询" --top-k 10` — 指定结果数量（默认 3）\n';
}

// 5) 输出 hook 结果（Claude Code SessionStart 格式）
if (context.trim()) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  }));
} else {
  console.log('{}');
}
