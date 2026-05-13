#!/usr/bin/env node
/**
 * instinct-status.js — 查看已学习的错误模式（Instinct 状态）
 *
 * 用法：bun run instinct:status
 *
 * 显示所有 .memory/instincts/*.md 文件的摘要：
 * - 触发条件、规则编号、触发次数、置信度、最近触发时间
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const projectRoot = process.cwd();
const instinctsDir = join(projectRoot, '.memory', 'instincts');

if (!existsSync(instinctsDir)) {
  console.log('📭 还没有学习到任何错误模式。');
  console.log('   触发一次被拦截的操作（如 Bash grep -r）即可开始记录。');
  process.exit(0);
}

const files = readdirSync(instinctsDir).filter(f => f.endsWith('.md') && f !== 'README.md');

if (files.length === 0) {
  console.log('📭 instincts/ 目录为空，尚无记录。');
  process.exit(0);
}

console.log(`\n🧠 已学习的错误模式（共 ${files.length} 条）\n`);
console.log('─'.repeat(70));

let totalBlocked = 0;

for (const file of files.sort()) {
  try {
    const content = readFileSync(join(instinctsDir, file), 'utf-8');

    const id = (content.match(/^id:\s*(.+)$/m) || [])[1]?.trim() || file.replace('.md', '');
    const trigger = (content.match(/^trigger:\s*"(.+)"$/m) || [])[1] || '?';
    const rule = (content.match(/^rule:\s*(.+)$/m) || [])[1]?.trim() || '?';
    const count = parseInt((content.match(/^count:\s*(\d+)$/m) || [])[1] || '0');
    const confidence = parseFloat((content.match(/^confidence:\s*([\d.]+)$/m) || [])[1] || '0');
    const lastSeen = (content.match(/^last_seen:\s*"(.+)"$/m) || [])[1]?.substring(0, 10) || '?';

    const correctionMatch = content.match(/## 正确做法\n([\s\S]+?)(?=\n##|$)/);
    const correction = correctionMatch ? correctionMatch[1].trim().substring(0, 60) : '';

    const countBar = '█'.repeat(Math.min(count, 10)) + '░'.repeat(Math.max(0, 10 - count));
    const emoji = count >= 5 ? '🔴' : count >= 3 ? '🟡' : '🟢';

    console.log(`${emoji} [${rule}] ${trigger}`);
    console.log(`   触发次数: ${countBar} ${count} 次  |  置信度: ${(confidence * 100).toFixed(0)}%  |  最近: ${lastSeen}`);
    if (correction) console.log(`   正确做法: ${correction}${correction.length >= 60 ? '...' : ''}`);
    console.log('');

    totalBlocked += count;
  } catch (e) {
    console.log(`⚠️  解析 ${file} 失败: ${e.message}`);
  }
}

console.log('─'.repeat(70));
console.log(`📊 总计拦截 ${totalBlocked} 次错误操作`);
console.log(`📁 存储位置：.memory/instincts/`);
console.log('');
