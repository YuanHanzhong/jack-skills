#!/usr/bin/env bun

/**
 * vec-watch.js — 文件变更监听 + 增量向量索引
 *
 * 替代 memsearch watch。
 * 用法：bun tools/vec-watch.js [目录1] [目录2] ...
 *       （默认监听: 整个项目根目录，排除 01_ODS）
 *
 * 设计要点：
 *   - Bun 内置 fs.watch，无额外依赖
 *   - debounce 2s，防止批量写入时重复索引
 *   - PID 写入 .memory/.vec-watch.pid
 *   - 无 DB 锁问题（vec-index.js 用完即释放连接）
 */

import { watch } from 'fs';
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const MEMSEARCH_DIR = join(PROJECT_ROOT, '.memory');
const PID_FILE = join(MEMSEARCH_DIR, '.vec-watch.pid');

// 写入 PID 文件（供 startup-optimize.js 管理进程）
if (!existsSync(MEMSEARCH_DIR)) mkdirSync(MEMSEARCH_DIR, { recursive: true });
writeFileSync(PID_FILE, String(process.pid), 'utf-8');

// 当前正在运行的子进程（模块作用域，供 cleanup 使用）
let currentProc = null;
// 是否正在索引中（必须在 cleanup 定义前声明，避免 let TDZ 问题）
let indexing = false;

// 进程退出时清理 PID 文件
function cleanup() {
  try { unlinkSync(PID_FILE); } catch (e) { console.error(`[vec-watch] PID 文件清理失败: ${e.message}`); }
  if (currentProc && indexing) {
    try { currentProc.kill(); } catch (e) { console.error(`[vec-watch] 子进程终止失败: ${e.message}`); }
  }
  process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT',  cleanup);

// ─── 监听目录配置 ────────────────────────────────────────────

// 监听整个项目根目录（排除 01_ODS 电子书目录）
const DEFAULT_DIRS = ['.'];
const EXCLUDED_PREFIXES = ['01_ODS'];

const dirsArg = process.argv.slice(2).filter(a => !a.startsWith('--'));
const watchDirs = (dirsArg.length > 0 ? dirsArg : DEFAULT_DIRS)
  .map(d => d.startsWith('/') ? d : join(PROJECT_ROOT, d))
  .filter(d => existsSync(d));

if (watchDirs.length === 0) {
  console.log('[vec-watch] 没有可监听的目录，退出');
  process.exit(0);
}

// ─── debounce 触发器 ──────────────────────────────────────────

let debounceTimer = null;
const pendingFiles = new Set();
const DEBOUNCE_MS = 2000;

function runIndex(changedFile) {
  if (indexing) {
    pendingFiles.add(changedFile); // 记录待处理，不丢弃（Set 避免重复）
    return;
  }
  indexing = true;
  const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  console.log(`[vec-watch] ${ts} 触发增量索引...`);
  currentProc = Bun.spawn(['bun', 'run', join(__dirname, 'vec-index.js'), '--incremental', '--quiet', '--file', changedFile], {
    cwd: PROJECT_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  currentProc.exited.then((code) => {
    indexing = false;
    currentProc = null;
    if (code === 0) {
      console.log(`[vec-watch] 索引完成`);
    } else {
      console.error(`[vec-watch] 索引失败 (exit ${code})`);
    }
    if (pendingFiles.size > 0) {
      const f = pendingFiles.values().next().value;
      pendingFiles.delete(f);
      setTimeout(() => runIndex(f), 500); // 延迟触发待处理变更
    }
  }).catch((e) => {
    console.error(`[vec-watch] 索引进程异常退出: ${e.message}`);
    indexing = false;
    currentProc = null;
    pendingFiles.clear();
  });
}

let lastChangedFile = '';

function scheduleReindex(filename) {
  if (filename) lastChangedFile = filename;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    runIndex(lastChangedFile);
  }, DEBOUNCE_MS);
}

// ─── 启动文件监听 ────────────────────────────────────────────

for (const dir of watchDirs) {
  try {
    watch(dir, { recursive: true }, (event, filename) => {
      // 只监听 .md 文件变更，排除 01_ODS 电子书目录
      if (filename && filename.endsWith('.md')) {
        const skip = EXCLUDED_PREFIXES.some(p =>
          filename === p || filename.startsWith(p + '/') || filename.startsWith(p + '\\')
        );
        if (!skip) scheduleReindex(join(dir, filename));
      }
    });
    console.log(`[vec-watch] 监听 ${dir.replace(PROJECT_ROOT + '/', '')}`);
  } catch (e) {
    console.error(`[vec-watch] 无法监听 ${dir}: ${e.message}`);
  }
}

console.log(`[vec-watch] 就绪 (PID=${process.pid}, debounce=${DEBOUNCE_MS}ms)`);
