#!/usr/bin/env bun

/**
 * vec-index.js — SQLite 向量索引构建器（多 Provider + 内容哈希去重）
 *
 * 替代 memsearch index。
 * 用法：bun tools/vec-index.js <目录1> [目录2] ...
 *
 * 三阶段流程：
 *   1. 扫描文件 + 切块 + 计算 content_hash
 *   2. 跳过哈希命中缓存的 chunk，批量 embed 新增 chunk
 *   3. 事务写入 DB
 *
 * Embedding Provider：阿里云百炼（L1） → null（L2）
 */

import { Database } from 'bun:sqlite';
import { readdirSync, statSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import path, { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { createProvider, embedBatch, embedSingle, getProviderInfo } from './lib/embedding-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const DB_PATH = join(PROJECT_ROOT, '.memory', 'vectors.db');

// ─── 终端样式 ────────────────────────────────────────────────

const c = {
  bold:   t => `\x1b[1m${t}\x1b[0m`,
  dim:    t => `\x1b[90m${t}\x1b[0m`,
  green:  t => `\x1b[32m${t}\x1b[0m`,
  red:    t => `\x1b[31m${t}\x1b[0m`,
  yellow: t => `\x1b[33m${t}\x1b[0m`,
  cyan:   t => `\x1b[36m${t}\x1b[0m`,
  blue:   t => `\x1b[34m${t}\x1b[0m`,
};

function printStep(icon, msg) {
  process.stdout.write(`  ${icon}  ${msg}\n`);
}

function printProgress(current, total, label, etaSec) {
  const pct = Math.round((current / total) * 100);
  const filled = Math.round(pct / 5);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  const eta = etaSec > 0 ? c.dim(` ~${formatTime(etaSec)} 剩余`) : '';
  process.stdout.write(`\r  [${current}/${total}] ${bar} ${String(pct).padStart(3)}%  ${c.dim(label.slice(-40).padEnd(40))}${eta}  `);
}

function formatTime(sec) {
  if (sec < 60) return `${Math.round(sec)}s`;
  return `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`;
}

// ─── Content Hash ────────────────────────────────────────────

function contentHash(source, heading, content) {
  return createHash('sha256')
    .update(source).update('\x00')
    .update(heading).update('\x00')
    .update(content)
    .digest('hex');
}

// ─── DB 初始化 ──────────────────────────────────────────────

function openDB() {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // 防御性清理：如果主 DB 不存在但 WAL/SHM 残留，先清除（避免 disk I/O error）
  if (!existsSync(DB_PATH)) {
    try { unlinkSync(DB_PATH + '-wal'); } catch {}
    try { unlinkSync(DB_PATH + '-shm'); } catch {}
  }

  const db = new Database(DB_PATH);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  db.run(`
    CREATE TABLE IF NOT EXISTS chunks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT    NOT NULL,
      heading    TEXT    NOT NULL DEFAULT '',
      content    TEXT    NOT NULL,
      content_hash TEXT,
      embedding  BLOB,
      mtime      INTEGER NOT NULL,
      size       INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_source ON chunks(source)');
  db.run('CREATE INDEX IF NOT EXISTS idx_source_mtime ON chunks(source, mtime, size)');

  // Migration: add content_hash column to existing DBs
  try { db.run('ALTER TABLE chunks ADD COLUMN content_hash TEXT'); } catch {}
  // Migration: add size column to existing DBs
  try { db.run('ALTER TABLE chunks ADD COLUMN size INTEGER NOT NULL DEFAULT 0'); } catch {}

  db.run('CREATE INDEX IF NOT EXISTS idx_hash ON chunks(content_hash)');

  // Metadata table: track which provider built the index
  db.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  return db;
}

function printStats() {
  if (!existsSync(DB_PATH)) {
    console.log(JSON.stringify({
      chunks: 0,
      embedded: 0,
      provider: null,
      db: DB_PATH.replace(PROJECT_ROOT + '/', ''),
    }, null, 2));
    return;
  }

  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db.query(`
      SELECT
        COUNT(*) as chunks,
        SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as embedded
      FROM chunks
    `).get();
    let provider = null;
    try {
      provider = db.query("SELECT value FROM meta WHERE key = 'embedding_provider'").get()?.value ?? null;
    } catch {}
    console.log(JSON.stringify({
      chunks: row?.chunks ?? 0,
      embedded: row?.embedded ?? 0,
      provider,
      db: DB_PATH.replace(PROJECT_ROOT + '/', ''),
    }, null, 2));
  } finally {
    db.close();
  }
}

// ─── 文件遍历 ────────────────────────────────────────────────

function* walkMdFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '01_ODS') {
        yield* walkMdFiles(full);
      }
    } else if (entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
      yield full;
    }
  }
}

// ─── 文本切块 ────────────────────────────────────────────────

function chunkMarkdown(text, maxChars = 500) {
  const chunks = [];
  let currentHeading = '';
  let currentLines = [];
  let currentLength = 0;

  function flush() {
    const content = currentLines.join('\n').trim();
    if (content.length > 20) chunks.push({ heading: currentHeading, content });
    currentLines = [];
    currentLength = 0;
  }

  for (const line of text.split('\n')) {
    const isHeading = /^#{1,3}\s/.test(line);
    if (isHeading) {
      if (currentLength > 0) flush();
      currentHeading = line.trim();
    }
    const safeLine = line.length > 800 ? line.slice(0, 800) + '…' : line;
    currentLines.push(safeLine);
    currentLength += safeLine.length + 1; // +1 for \n
    if (currentLength > maxChars && !isHeading) flush();
  }
  flush();
  return chunks;
}

// ─── Embedding → Blob ────────────────────────────────────────

function embeddingToBlob(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

// ─── 主流程 ──────────────────────────────────────────────────

async function main() {
  // ── dry-run 快速退出 ──
  if (process.env.VEC_DRY_RUN === '1') {
    console.log('  [dry-run] vec-index.js skipped');
    process.exit(0);
  }

  const rawArgs = process.argv.slice(2);
  const quiet = rawArgs.includes('--quiet');
  if (rawArgs.includes('--stats')) {
    printStats();
    process.exit(0);
  }

  // 识别 --file <path> 参数（来自 vec-watch.js 的增量调用）
  let singleFile = null;
  const fileIdx = rawArgs.indexOf('--file');
  if (fileIdx !== -1 && rawArgs[fileIdx + 1]) {
    singleFile = rawArgs[fileIdx + 1];
    // 白名单验证：路径必须在项目目录内
    const singleFileValidated = path.resolve(singleFile.startsWith('/') ? singleFile : join(PROJECT_ROOT, singleFile));
    if (!singleFileValidated.startsWith(PROJECT_ROOT + path.sep) && singleFileValidated !== PROJECT_ROOT) {
      console.error(`[vec-index] 错误：文件路径 "${singleFileValidated}" 不在项目目录内`);
      process.exit(1);
    }
  }

  // 普通目录参数（排除所有 -- 开头及其后跟随的值）
  const args = (() => {
    const result = [];
    for (let i = 0; i < rawArgs.length; i++) {
      if (rawArgs[i] === '--file') { i++; continue; } // 跳过 --file <path>
      if (rawArgs[i].startsWith('--')) continue;       // 跳过其他 flag
      result.push(rawArgs[i]);
    }
    return result;
  })();

  // 如果传入了 --file，把该文件的父目录加入 args
  if (singleFile && args.length === 0) {
    const singleFileAbs = singleFile.startsWith('/') ? singleFile : join(PROJECT_ROOT, singleFile);
    args.push(dirname(singleFileAbs));
  }

  if (args.length === 0) {
    console.error('Usage: bun tools/vec-index.js <dir1> [dir2] ...');
    process.exit(1);
  }

  // ── 索引前停止 watch 进程，避免 WAL 锁冲突（仅非 quiet 模式）──
  const pidFile = join(dirname(DB_PATH), '.vec-watch.pid');
  if (!quiet) {
    try {
      const pid = parseInt(readFileSync(pidFile, 'utf8').trim());
      if (pid) {
        try { process.kill(pid); } catch (e) {
          // 进程已不存在是正常情况，其他错误才需要提示
          if (e.code !== 'ESRCH') console.error(`  ⚠️  停止 vec-watch 时出错: ${e.message}`);
        }
      }
      try { unlinkSync(pidFile); } catch {}
      console.log('  🛑  已停止 vec-watch 进程');
    } catch {
      // pid 文件不存在 = watch 未运行，静默跳过
    }
  }

  // ── 首次运行检测 ──
  const isFirstRun = !existsSync(DB_PATH);
  if (!quiet) {
    console.log('');
    console.log(c.bold('  🗂️  向量索引构建器'));
    if (isFirstRun) {
      console.log(c.yellow('  （首次运行，将自动完成环境准备）'));
    }
    console.log('');
  }

  // ── Step 1: 初始化 Embedding Provider ──
  await createProvider();
  const { name: providerName, dimension } = getProviderInfo();
  if (!quiet) printStep('🔌', `Embedding: ${providerName} (${dimension}维)`);

  if (providerName === 'null') {
    if (!quiet) {
      console.log(c.yellow('  ⚠️  无可用 Embedding Provider，将跳过 embedding（只建立文件列表）'));
      console.log(c.dim('     下次运行时会自动重试'));
    }
  }

  // ── Step 2: 扫描文件 ──
  if (!quiet) process.stdout.write('  📁  扫描 .md 文件...');

  const allFiles = [];
  // 如果指定了单文件，只处理该文件，无需遍历整个目录
  if (singleFile) {
    const singleFileAbs = singleFile.startsWith('/') ? singleFile : join(PROJECT_ROOT, singleFile);
    if (existsSync(singleFileAbs) && singleFileAbs.endsWith('.md')) {
      allFiles.push(singleFileAbs);
    }
  } else {
    for (const dirArg of args) {
      const absDir = dirArg.startsWith('/') ? dirArg : join(PROJECT_ROOT, dirArg);
      for (const filePath of walkMdFiles(absDir)) {
        allFiles.push(filePath);
      }
    }
  }

  if (!quiet) console.log(c.green(` ✓ 找到 ${allFiles.length} 个文件`));

  // ── Step 3: 计算增量（哪些需要重新索引） ──
  const db = openDB();
  if (quiet) {
    db.run('PRAGMA busy_timeout = 5000');
  }
  try {
    const existing = new Map();
    for (const row of db.query('SELECT source, MAX(mtime) as mtime, MAX(size) as size FROM chunks GROUP BY source').all()) {
      existing.set(row.source, { mtime: row.mtime, size: row.size });
    }

    const toIndex = [];
    const currentFiles = new Set();
    for (const filePath of allFiles) {
      const relPath = relative(PROJECT_ROOT, filePath);
      currentFiles.add(relPath);
      const stat = statSync(filePath);
      const mtime = Math.round(stat.mtimeMs);
      const size = stat.size;
      const rec = existing.get(relPath);
      if (!rec || rec.mtime !== mtime || rec.size !== size) {
        toIndex.push({ filePath, relPath, mtime, size });
      }
    }

    const skipped = allFiles.length - toIndex.length;

    if (!quiet) {
      if (toIndex.length === 0) {
        console.log(c.green('  ✅ 索引已是最新，无需更新'));
      } else {
        console.log(`  🔄  需要索引: ${c.yellow(String(toIndex.length))} 个文件，跳过: ${c.dim(String(skipped))} 个（未变化）`);
      }
    }

    if (toIndex.length > 0) {
      const startTime = Date.now();

      // ── Phase 1: 扫描 & 切块所有待索引文件 ──
      if (!quiet) {
        console.log('');
        printStep('📄', '扫描 & 切块...');
      }

      const allChunks = []; // { relPath, mtime, size, heading, content, hash }
      const fileTotal = toIndex.length;
      const milestoneStep = Math.max(1, Math.floor(fileTotal / 10));

      for (let i = 0; i < fileTotal; i++) {
        const { filePath, relPath, mtime, size } = toIndex[i];
        let text;
        try {
          text = await Bun.file(filePath).text();
        } catch (e) {
          console.error(`\n  ❌ 读取文件失败 [${relPath}]: ${e.message}`);
          continue;
        }
        for (const chunk of chunkMarkdown(text)) {
          const hash = contentHash(relPath, chunk.heading, chunk.content);
          allChunks.push({ relPath, mtime, size, heading: chunk.heading, content: chunk.content, hash });
        }
        if (!quiet) {
          printProgress(i + 1, fileTotal, relPath, 0);
          // 每 10% 或最后一个文件时，换行输出里程碑进度（保留在滚动历史中）
          if ((i + 1) % milestoneStep === 0 || i === fileTotal - 1) {
            const pct = Math.round((i + 1) / fileTotal * 100);
            process.stdout.write(`\n  📄 进度：${i + 1}/${fileTotal} 文件 (${pct}%) — 已切 ${allChunks.length} chunks\n`);
          }
        }
      }

      if (!quiet) process.stdout.write('\n');

      // ── Phase 2: 哈希去重 + 批量 embed ──
      // Pre-load existing content_hash → embedding mapping
      const hashCache = new Map();
      for (const row of db.query('SELECT content_hash, embedding FROM chunks WHERE content_hash IS NOT NULL AND embedding IS NOT NULL').all()) {
        hashCache.set(row.content_hash, row.embedding);
      }

      const toEmbedChunks = allChunks.filter(c => !hashCache.has(c.hash));
      const cachedCount = allChunks.length - toEmbedChunks.length;

      if (!quiet) {
        console.log(`  📊  ${allChunks.length} chunks 总计, ${c.green(String(cachedCount))} 命中缓存, ${c.yellow(String(toEmbedChunks.length))} 需要 embedding`);
      }

      if (toEmbedChunks.length > 0 && providerName !== 'null') {
        const EMBED_BATCH_SIZE = 10; // 与 DashScope batchSize 对齐，每批可见进度
        const batchTotal = Math.ceil(toEmbedChunks.length / EMBED_BATCH_SIZE);
        if (!quiet) printStep('🧠', `批量 embedding ${toEmbedChunks.length} chunks（共 ${batchTotal} 批，每批 ${EMBED_BATCH_SIZE} 个）...`);

        const allEmbeddings = [];
        let embeddedCount = 0;

        for (let batchIdx = 0; batchIdx < batchTotal; batchIdx++) {
          const batchStart = batchIdx * EMBED_BATCH_SIZE;
          const batchEnd = Math.min(batchStart + EMBED_BATCH_SIZE, toEmbedChunks.length);
          const batchTexts = toEmbedChunks.slice(batchStart, batchEnd).map(c => c.content);

          let batchResults;
          try {
            batchResults = await Promise.race([
              embedBatch(batchTexts),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('embedding 超时（10s），跳过此批次')), 10000)
              )
            ]);
          } catch (e) {
            console.error(`\n  ❌ embedding 第 ${batchIdx + 1} 批失败，跳过: ${e.message}`);
            batchResults = batchTexts.map(() => null); // 降级：跳过该批
          }

          for (const emb of batchResults) allEmbeddings.push(emb);

          if (!quiet) {
            const doneChunks = batchEnd;
            const pct = Math.round(doneChunks / toEmbedChunks.length * 100);
            console.log(`  🔢 embedding 批次 ${batchIdx + 1}/${batchTotal} 完成 — ${doneChunks}/${toEmbedChunks.length} chunks (${pct}%)`);
          }
        }

        for (let i = 0; i < toEmbedChunks.length; i++) {
          if (allEmbeddings[i]) {
            hashCache.set(toEmbedChunks[i].hash, embeddingToBlob(allEmbeddings[i]));
            embeddedCount++;
          }
        }

        if (!quiet) {
          const failedEmbed = toEmbedChunks.length - embeddedCount;
          if (failedEmbed > 0) {
            console.log(c.yellow(`  ⚠️  ${failedEmbed} 个 chunks embedding 失败（API 返回 null，将以无向量形式存储）`));
          }
          printStep('✅', `Embedding 完成: ${embeddedCount}/${toEmbedChunks.length} 成功`);
        }
      }

      // ── Phase 3: 事务写入 DB ──
      if (!quiet) printStep('💾', '写入数据库...');

      const insert = db.prepare(
        'INSERT INTO chunks (source, heading, content, content_hash, embedding, mtime, size, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );

      let totalChunks = 0;
      let failedChunks = 0;

      db.run('BEGIN');
      try {
        // Delete old chunks for all sources being re-indexed
        const sources = new Set(toIndex.map(f => f.relPath));
        for (const src of sources) {
          db.run('DELETE FROM chunks WHERE source = ?', [src]);
        }

        const now = Date.now();
        for (const chunk of allChunks) {
          const blob = hashCache.get(chunk.hash);
          if (blob) {
            insert.run(chunk.relPath, chunk.heading, chunk.content, chunk.hash, blob, chunk.mtime, chunk.size, now);
            totalChunks++;
          } else {
            // No embedding available (provider returned null or L3 mode)
            insert.run(chunk.relPath, chunk.heading, chunk.content, chunk.hash, null, chunk.mtime, chunk.size, now);
            failedChunks++;
          }
        }
        // Record which provider built this index
        db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('embedding_provider', ?)`, [providerName]);
        db.run('COMMIT');
      } catch (txErr) {
        try { db.run('ROLLBACK'); } catch {}
        console.error(`\n  ⚠️  事务失败: ${txErr.message}`);
        try { db.close(); } catch {}  // 确保 WAL 正确关闭，不依赖 finally
        process.exit(1);
      }

      // ── 完成统计 ──
      const elapsed = (Date.now() - startTime) / 1000;

      if (!quiet) {
        console.log('');
        if (failedChunks > 0) {
          console.log(c.yellow(`  ⚠️  ${failedChunks} 个 chunks 无 embedding（provider 返回 null）`));
          console.log(c.dim('     下次运行时会自动重试'));
        }
        console.log(c.green(`  ✅ 索引完成！${totalChunks} 个 chunks（${cachedCount} 命中缓存），耗时 ${formatTime(elapsed)}`));
      }
    }

    // ── Step 4: 清理 orphan chunks（仅全量模式，单文件模式跳过避免误删整库）──
    if (!singleFile) {
      let orphanCount = 0;
      db.run('BEGIN');
      try {
        for (const source of existing.keys()) {
          if (!currentFiles.has(source)) {
            db.run('DELETE FROM chunks WHERE source = ?', [source]);
            orphanCount++;
          }
        }
        db.run('COMMIT');
      } catch (e) {
        try { db.run('ROLLBACK'); } catch {}
        if (!quiet) console.error(`\n  ⚠️  孤儿清理事务失败: ${e.message}`);
      }
      if (orphanCount > 0 && !quiet) {
        console.log(c.dim(`  🧹  清理 ${orphanCount} 个已删除文件的 orphan chunks`));
      }
    }

    // ── 最终统计 ──
    const total = db.query('SELECT COUNT(*) as n FROM chunks').get();
    if (!quiet) {
      console.log('');
      console.log(c.dim(`  📊  索引总量：${total.n} chunks | DB: ${DB_PATH.replace(PROJECT_ROOT + '/', '')}`));
      console.log('');
    }
  } finally {
    db.close();
  }
}

main().catch(e => {
  console.error(c.red('\n  ❌ vec-index 出错: ') + e.message);
  process.exit(1);
});
