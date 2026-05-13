#!/usr/bin/env bun

/**
 * vec-search.js — SQLite 向量相似度搜索
 *
 * 用法：bun tools/vec-search.js "查询文本" [--top-k 3]
 *
 * 输出（JSON 数组）：
 *   [{"score": 0.85, "content": "...", "source": "file.md", "heading": "### 标题"}]
 *
 * 设计要点：
 *   - 纯 JS 余弦相似度（Float32Array，线性扫描）
 *   - 2000 chunks × 768 dim ≈ 6MB，内存加载 < 50ms
 *   - Embedding provider：阿里云百炼 → null 降级
 *   - DB 不存在 → 返回空数组（静默降级）
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createProvider, embedSingle } from './lib/embedding-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const DB_PATH = join(PROJECT_ROOT, '.memory', 'vectors.db');

// ─── 余弦相似度（Float32Array） ────────────────────────────────

function cosine(a, b) {
  if (a.length !== b.length) return 0; // 维度不匹配，静默跳过
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function blobToFloat32(buf) {
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

// ─── 主流程 ──────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let topK = 3;
  const queryParts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--top-k' && args[i + 1]) {
      topK = parseInt(args[i + 1]) || 3;
      i++;
    } else if (!args[i].startsWith('--')) {
      queryParts.push(args[i]);
    }
  }
  const query = queryParts.join(' ').trim();

  if (!query) {
    console.error('Usage: bun tools/vec-search.js "查询文本" [--top-k 3]');
    process.exit(1);
  }

  // DB 不存在时提示用户建立索引
  if (!existsSync(DB_PATH)) {
    if (!process.stdout.isTTY) {
      console.log('[]');
      process.exit(0);
    }
    console.error('');
    console.error('  ⚠️  向量索引尚未建立，请先运行：');
    console.error('     bun run memory:index');
    console.error('');
    console.log('[]');
    process.exit(0);
  }

  // 初始化 embedding provider
  await createProvider();

  // 获取查询向量
  const queryEmb = await embedSingle(query);
  if (!queryEmb) {
    // Provider 不可用（null mode）— 无论 TTY 还是管道都输出，便于 hook 捕获
    process.stderr.write('  ⚠️  Embedding provider 不可用，无法执行向量搜索（详见上方错误信息）\n');
    console.log('[]');
    process.exit(0);
  }

  // 与 lib/embedding-provider.js 中 PROVIDERS.L1.name 保持一致
  const EXPECTED_PROVIDER = 'dashscope-v4';

  const db = new Database(DB_PATH, { readonly: true });

  let rows;
  try {
    // 验证索引与当前 provider 是否匹配
    const metaRow = db.query(`SELECT value FROM meta WHERE key = 'embedding_provider'`).get();
    if (metaRow && metaRow.value !== EXPECTED_PROVIDER) {
      process.stderr.write(`  ⚠️  索引由 "${metaRow.value}" 构建，当前 provider 为 "${EXPECTED_PROVIDER}"，向量不兼容，建议重建索引：bun run memory:rebuild:force\n`);
      console.log('[]');
      process.exit(0);
    }

    const countRow = db.query('SELECT COUNT(*) as n FROM chunks WHERE embedding IS NOT NULL').get();
    const totalChunks = countRow ? countRow.n : 0;
    if (totalChunks > 5000 && process.stderr.isTTY) {
      process.stderr.write(`  ⚠️  索引较大（${totalChunks} chunks），搜索可能较慢。建议分目录管理或重建索引。\n`);
    }
    rows = db.query('SELECT source, heading, content, embedding FROM chunks WHERE embedding IS NOT NULL').all();
  } finally {
    db.close();
  }

  if (rows.length === 0) {
    console.log('[]');
    process.exit(0);
  }

  // 计算余弦相似度
  const scored = rows.map(row => ({
    score:   cosine(queryEmb, blobToFloat32(row.embedding)),
    source:  row.source,
    heading: row.heading,
    content: row.content,
  }));

  scored.sort((a, b) => b.score - a.score);
  const results = scored.filter(r => r.score > 0).slice(0, topK);

  console.log(JSON.stringify(results.map(r => ({
    score:   r.score,
    source:  r.source,
    heading: r.heading,
    content: r.content,
  }))));
}

main().catch(e => {
  console.error('⚠️  [vec-search] 搜索失败:', e.message);
  console.log('[]');
  process.exit(0);
});
