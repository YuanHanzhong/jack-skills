#!/usr/bin/env bun

/**
 * fallback-memory-search.js
 *
 * vec-search 不可用时的降级搜索引擎：
 *   L2: llmSemanticSearch  → 调用 claude -p（当前模型）做语义匹配
 *   L3: grepSearch         → 系统 grep 关键词全文搜索
 *
 * 返回格式统一兼容 vec-search：
 *   [{score: 0-1, content: string, source: string, heading: string}]
 *
 * 约束：
 *   - 零外部依赖（只用 Node.js 内置 + Bun 内置）
 *   - 防递归：调用 claude -p 时传入 MEMORY_INJECT_ACTIVE=true
 *   - 静默失败：出错时返回空数组
 */

import { spawnSync } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';

// ─── 工具函数 ─────────────────────────────────────────────────

/**
 * 获取最近的 memory/*.md 文件（按修改时间倒序）
 */
function getRecentMemoryFiles(memoryDir, maxFiles = 5) {
  if (!existsSync(memoryDir)) return [];
  try {
    return readdirSync(memoryDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({ path: join(memoryDir, f), mtime: statSync(join(memoryDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, maxFiles)
      .map(f => f.path);
  } catch (e) {
    console.error('⚠️  读取记忆目录失败:', e.message);
    return [];
  }
}

/**
 * 从 query 中提取有效关键词（3+ 字，去除停用词）
 */
function extractKeywords(query) {
  const stopWords = new Set(['什么', '怎么', '为什么', '如何', '是否', '可以', '需要', '一个', '这个', '那个', 'the', 'is', 'are', 'how', 'what', 'why']);
  return query
    .split(/[\s，。？！,.?!;；\n\r]+/)
    .map(w => w.trim())
    .filter(w => w.length >= 3 && !stopWords.has(w))
    .slice(0, 3); // 最多 3 个关键词
}

/**
 * 从文件内容中解析最近的 ### HH:MM heading
 */
function extractHeading(content, matchLine) {
  const lines = content.split('\n');
  const matchIdx = lines.findIndex(l => l.includes(matchLine));
  for (let i = matchIdx; i >= 0; i--) {
    if (lines[i].startsWith('### ')) return lines[i];
  }
  return '';
}

// ─── L2: LLM 语义搜索 ─────────────────────────────────────────

/**
 * 使用 claude -p（当前默认模型）做语义搜索
 * @param {string} query - 用户查询
 * @param {number} topK - 返回数量
 * @param {string} projectRoot - 项目根目录
 * @returns {Array<{score, content, source, heading}>}
 */
export async function llmSemanticSearch(query, topK = 3, projectRoot = process.cwd()) {
  const memoryDir = join(projectRoot, '.memory', 'memory');
  const files = getRecentMemoryFiles(memoryDir, 5);
  if (files.length === 0) return [];

  // 读取并拼接内容，最新优先，总计截断到 4000 字
  let combined = '';
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const filename = basename(file);
      const section = `=== ${filename} ===\n${content}\n\n`;
      if (combined.length + section.length > 4000) {
        combined += section.substring(0, 4000 - combined.length);
        break;
      }
      combined += section;
    } catch (e) {
      console.error(`⚠️  读取记忆文件失败 (${basename(file)}):`, e.message);
    }
  }

  if (!combined.trim()) return [];

  const systemPrompt = `You are a memory search assistant for a personal knowledge base.
Given a user query and memory snippets, find the top ${topK} most relevant snippets.
Output ONLY a valid JSON array (no markdown, no explanation):
[{"score": 0.95, "content": "the exact relevant text", "source": "filename.md", "heading": "### HH:MM"}]
If no relevant snippets found, output: []`;

  const userPrompt = `Query: ${query}\n\nMemories:\n${combined}`;

  const result = spawnSync('claude', [
    '-p',
    '--no-session-persistence',
    '--no-chrome',
    '--system-prompt', systemPrompt,
  ], {
    input: userPrompt,
    encoding: 'utf-8',
    timeout: 4000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MEMORY_INJECT_ACTIVE: 'true',  // 防递归
      STOP_HOOK_ACTIVE: 'true',       // 防止触发 Stop hook
    },
  });

  if (result.signal) {
    console.error(`[L2] claude -p 超时 (SIGTERM)，降级到 L3`);
  }
  if (result.status !== 0 || !result.stdout) return [];

  try {
    // 提取 JSON（可能被 markdown 包裹）
    const raw = result.stdout.trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    // 标准化字段，确保 score 在 0-1 范围
    return parsed
      .filter(r => r && typeof r === 'object')
      .map(r => ({
        score: Math.min(1, Math.max(0, parseFloat(r.score) || 0.5)),
        content: String(r.content || ''),
        source: String(r.source || ''),
        heading: String(r.heading || ''),
      }))
      .filter(r => r.content)
      .slice(0, topK);
  } catch (e) {
    console.error('⚠️  解析 LLM 返回结果失败:', e.message);
    return [];
  }
}

// ─── L3: grep 全文搜索 ────────────────────────────────────────

/**
 * 使用系统 grep 在整个知识库中全文搜索
 * 搜索范围：.memory/memory + 00_DIM + 02_DWD + 03_DWS + 04_ADS
 *
 * @param {string} query - 用户查询
 * @param {number} topK - 返回数量
 * @param {string} projectRoot - 项目根目录
 * @returns {Array<{score, content, source, heading}>}
 */
export async function grepSearch(query, topK = 3, projectRoot = process.cwd()) {
  // 搜索范围：覆盖整个知识库（优先记忆文件，然后知识文档）
  const SEARCH_DIRS = [
    join(projectRoot, '.memory', 'memory'),
    join(projectRoot, '00_DIM'),
    join(projectRoot, '02_DWD'),
    join(projectRoot, '03_DWS'),
    join(projectRoot, '04_ADS'),
  ].filter(d => existsSync(d));

  if (SEARCH_DIRS.length === 0) return [];

  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  /** @type {Map<string, {hits: number, file: string}>} */
  const fileHits = new Map();

  for (const keyword of keywords) {
    for (const searchDir of SEARCH_DIRS) {
      // rg：递归、忽略大小写；--files-with-matches 只返回文件名（快速定位）
      // --fixed-strings 将 keyword 视为字面量，防止 regex 注入
      const result = spawnSync('rg', [
        '--ignore-case',
        '--files-with-matches',
        '--glob', '*.md',
        '--fixed-strings',
        keyword,
        searchDir,
      ], { encoding: 'utf-8', timeout: 3000 });

      if (result.signal) {
        console.error(`[L3] rg 超时，跳过目录`);
      }
      if (result.status !== 0 || !result.stdout) continue;

      const matchedFiles = result.stdout.trim().split('\n').filter(Boolean);
      for (const file of matchedFiles) {
        const entry = fileHits.get(file) || { hits: 0, file };
        entry.hits++;
        fileHits.set(file, entry);
      }
    } // end searchDir loop
  } // end keyword loop

  if (fileHits.size === 0) return [];

  // 按命中次数排序，取最多 topK 个文件
  const topFiles = [...fileHits.values()]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, topK);

  const results = [];

  for (const { hits, file } of topFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      const filename = basename(file);

      // 找到第一个命中行（用第一个关键词）
      const firstKeyword = keywords[0];
      // rg：--context 前后各 2 行，--max-count 只取第一个匹配
      // --fixed-strings 防止 regex 注入，--no-heading --no-filename 简化输出格式
      const grepResult = spawnSync('rg', [
        '--ignore-case',
        '--context', '2',
        '--max-count', '1',
        '--fixed-strings',
        '--no-heading',
        '--no-filename',
        firstKeyword,
        file,
      ], { encoding: 'utf-8', timeout: 3000 });

      // rg 行内容格式：行号:内容（匹配行）或 行号-内容（上下文行），统一去除前缀
      const snippet = grepResult.status === 0
        ? grepResult.stdout.replace(/^\d+[:\-]/gm, '').trim().substring(0, 300)
        : content.substring(0, 300);

      // 解析最近的 ### HH:MM heading
      const heading = extractHeading(content, firstKeyword) || '';

      // score：命中次数越多越高（hits 越多分数越高，最高 0.95）
      const score = Math.min(0.95, 0.3 + (hits * 0.15));

      results.push({
        score,
        content: snippet,
        source: filename,
        heading,
      });
    } catch (e) {
      console.error(`⚠️  读取文件内容失败 (${file}):`, e.message);
    }
  }

  return results;
}

// ─── CLI 入口（直接运行时使用）────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const query = args[0] || '';
  const projectRoot = args[1] || process.cwd();

  if (!query) {
    console.log('用法: bun run tools/fallback-memory-search.js "查询内容" [项目根目录]');
    process.exit(0);
  }

  console.log(`L2 语义搜索: "${query}"...`);
  const llmResults = await llmSemanticSearch(query, 3, projectRoot);
  if (llmResults.length > 0) {
    console.log('L2 结果:', JSON.stringify(llmResults, null, 2));
    process.exit(0);
  }

  console.log('L2 无结果，尝试 L3 grep...');
  const grepResults = await grepSearch(query, 3, projectRoot);
  console.log('L3 结果:', JSON.stringify(grepResults, null, 2));
}
