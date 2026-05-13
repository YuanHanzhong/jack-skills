#!/usr/bin/env bun

/**
 * 会话数据提取工具 - 从 JSONL 提取结构化 JSON
 *
 * 职责：纯数据提取，不做格式化（格式化由 Claude 大模型完成）
 *
 * 使用方式：
 *   bun run archive-conversation --json                    # 提取当前会话，输出 JSON
 *   bun run archive-conversation --json --full             # 不截断消息内容（完整输出）
 *   bun run archive-conversation --json --session=<id>     # 指定会话 ID
 *   bun run archive-conversation --list                    # 列出最近会话
 *   bun run archive-conversation --help                    # 帮助信息
 *
 * 配合 Claude 使用：
 *   用户说"沉淀"→ Claude 调用此工具获取 JSON → Claude 用 STARTT skill 格式化
 */

import os from 'os';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Claude 项目目录（JSONL 文件存储位置）
// 动态匹配：根据当前工作目录推算 Claude 项目路径
function getClaudeProjectDir() {
  const home = os.homedir();
  const projectsBase = join(home, '.claude', 'projects');

  // 从当前工作目录推算 Claude 项目目录名
  // Claude Code 的映射规则：路径中每个 / 和 \ 替换为 -（包括前导 /）
  // Windows: E:\GitHub\2_claude → E--GitHub-2-claude
  // Linux:   /home/jack/1_learn → -home-jack-1-learn（前导 / 也变 -）
  const cwd = process.cwd();
  const isWindows = os.platform() === 'win32';
  const cwdMapped = isWindows
    ? cwd.replace(/^([A-Za-z]):/, '$1-').replace(/[\\/]/g, '-').replace(/_/g, '-')
    : cwd.replace(/\//g, '-').replace(/_/g, '-');

  // 方法 1：精确匹配
  const dynamicDir = join(projectsBase, cwdMapped);
  if (existsSync(dynamicDir)) return dynamicDir;

  // 方法 2：大小写不敏感匹配（Windows 路径不区分大小写）
  const cwdLower = cwdMapped.toLowerCase();
  if (existsSync(projectsBase)) {
    const dirs = readdirSync(projectsBase);
    const match = dirs.find(d => d.toLowerCase() === cwdLower);
    if (match) return join(projectsBase, match);
  }

  return dynamicDir; // 返回推算路径供错误提示
}

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    sessionId: null,
    json: false,
    full: false,  // --full: 不截断消息内容
    list: false,
    help: false,
    limit: 10,  // --list 默认显示最近 10 个
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') config.help = true;
    else if (arg === '--json') config.json = true;
    else if (arg === '--full') config.full = true;
    else if (arg === '--list') config.list = true;
    else if (arg.startsWith('--session=')) config.sessionId = arg.split('=')[1];
    else if (arg.startsWith('--limit=')) config.limit = parseInt(arg.split('=')[1]) || 10;
  }

  return config;
}

function showHelp() {
  console.log(`
会话数据提取工具 - 从 JSONL 提取结构化 JSON

用法：
  bun run archive-conversation --json [--session=<id>]   提取会话数据，输出 JSON
  bun run archive-conversation --json --full             不截断消息内容（完整输出）
  bun run archive-conversation --list [--limit=N]        列出最近 N 个会话（默认 10）
  bun run archive-conversation --help                    显示帮助

说明：
  本工具只做数据提取，输出 JSON 到 stdout。
  格式化和文档生成由 Claude 大模型通过 STARTT formatter skill 完成。

工作流：
  1. 运行此工具获取 JSON 数据
  2. Claude 读取 JSON 输出
  3. Claude 用大模型能力智能总结
  4. Claude 按 STARTT 模板生成文档并保存到 03_DWS/sessions/
`);
}

// 列出最近的会话文件
function listRecentSessions(limit) {
  const projectDir = getClaudeProjectDir();

  if (!existsSync(projectDir)) {
    console.error(`❌ 找不到项目目录: ${projectDir}`);
    process.exit(1);
  }

  const files = readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const filePath = join(projectDir, f);
      const stat = statSync(filePath);
      return {
        sessionId: f.replace('.jsonl', ''),
        path: filePath,
        mtime: stat.mtime,
        size: stat.size,
      };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  if (files.length === 0) {
    console.log('没有找到任何会话文件。');
    return;
  }

  console.log(`最近 ${files.length} 个会话：\n`);
  for (const f of files) {
    const sizeKB = (f.size / 1024).toFixed(1);
    const time = f.mtime.toLocaleString('zh-CN');
    console.log(`  ${f.sessionId}`);
    console.log(`    修改时间: ${time}  大小: ${sizeKB} KB\n`);
  }
}

// 获取当前会话 ID（从最新 JSONL 文件推断）
function getCurrentSessionId() {
  if (process.env.CLAUDE_SESSION_ID) {
    return process.env.CLAUDE_SESSION_ID;
  }

  const projectDir = getClaudeProjectDir();
  if (!existsSync(projectDir)) return null;

  const files = readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      name: f.replace('.jsonl', ''),
      mtime: statSync(join(projectDir, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].name : null;
}

// 解析 JSONL 文件，提取消息
function parseConversationJSONL(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const userMessages = [];
  const assistantMessages = [];
  let startTime = null;
  let endTime = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const event = JSON.parse(line);
      const timestamp = event.timestamp || null;

      // 记录时间范围
      if (timestamp) {
        if (!startTime) startTime = timestamp;
        endTime = timestamp;
      }

      // 提取用户消息
      if (event.type === 'user' && event.message?.content) {
        const content = extractTextContent(event.message.content);
        if (content) {
          userMessages.push({ content, timestamp });
        }
      }

      // 提取助手回复
      if (event.type === 'assistant' && event.message?.content) {
        const content = extractAssistantText(event.message.content);
        if (content) {
          assistantMessages.push({ content, timestamp });
        }
      }
    } catch {
      // 忽略解析错误的行
      continue;
    }
  }

  return { userMessages, assistantMessages, startTime, endTime };
}

// 从用户消息中提取纯文本（处理字符串和数组两种格式）
function extractTextContent(content) {
  if (typeof content === 'string') return content.trim();

  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n\n')
      .trim();
  }

  return '';
}

// 从助手回复中提取文本（过滤 tool_use 等非文本块）
function extractAssistantText(content) {
  if (typeof content === 'string') return content.trim();

  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n\n')
      .trim();
  }

  return '';
}

// 简单关键词提取（词频统计）
function extractTopKeywords(messages, topN = 10) {
  const allText = messages.map(m => m.content).join(' ');

  // 中文分词：提取连续中文词组（2-6字）
  const chineseWords = allText.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  // 英文单词（3字以上）
  const englishWords = (allText.match(/[a-zA-Z][a-zA-Z0-9_.-]{2,}/g) || [])
    .map(w => w.toLowerCase());

  const words = [...chineseWords, ...englishWords];

  // 停用词
  const stopWords = new Set([
    '这个', '那个', '什么', '怎么', '可以', '需要', '使用', '进行', '已经',
    '一个', '不是', '没有', '我们', '你们', '他们', '因为', '所以', '但是',
    '如果', '就是', '还是', '或者', '以及', '通过', '其中', '目前', '然后',
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was',
    'not', 'but', 'have', 'has', 'had', 'will', 'can', 'would', 'could',
  ]);

  // 词频统计
  const freq = {};
  for (const w of words) {
    if (stopWords.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

// 截断长文本（用于摘要）
function truncate(text, maxLen = 500) {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}

// 主函数
function main() {
  const config = parseArgs();

  if (config.help) {
    showHelp();
    return;
  }

  if (config.list) {
    listRecentSessions(config.limit);
    return;
  }

  // 默认行为：--json 模式
  if (!config.json) {
    // 没有指定任何模式时，也输出 JSON（向后兼容提示）
    console.error('提示：请使用 --json 模式输出结构化数据，或 --list 查看会话列表。');
    console.error('示例：bun run archive-conversation --json');
    console.error('');
    config.json = true;
  }

  // 获取会话 ID
  const sessionId = config.sessionId || getCurrentSessionId();

  if (!sessionId) {
    console.error('❌ 无法找到会话 ID。请使用 --session=<id> 指定。');
    console.error('使用 --list 查看可用会话。');
    process.exit(1);
  }

  // 定位 JSONL 文件
  const projectDir = getClaudeProjectDir();
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`);

  if (!existsSync(jsonlPath)) {
    console.error(`❌ 找不到会话文件: ${jsonlPath}`);
    console.error('使用 --list 查看可用会话。');
    process.exit(1);
  }

  // 解析 JSONL
  const { userMessages, assistantMessages, startTime, endTime } = parseConversationJSONL(jsonlPath);

  if (userMessages.length === 0 && assistantMessages.length === 0) {
    console.error('❌ 会话中没有有效的消息。');
    process.exit(1);
  }

  // 提取关键词
  const allMessages = [...userMessages, ...assistantMessages];
  const topKeywords = extractTopKeywords(allMessages);

  // 计算摘要统计
  const totalCharacters = allMessages.reduce((sum, m) => sum + m.content.length, 0);
  const durationMinutes = (startTime && endTime)
    ? Math.round((new Date(endTime) - new Date(startTime)) / 60000)
    : null;

  // 截断策略：--full 模式下不截断
  const maxLen = config.full ? Infinity : 2000;

  // 构建 JSON 输出
  const output = {
    sessionId,
    startTime,
    endTime,
    messageCount: {
      user: userMessages.length,
      assistant: assistantMessages.length,
      total: userMessages.length + assistantMessages.length,
    },
    totalCharacters,
    durationMinutes,
    summary: {
      firstUserMessage: truncate(userMessages[0]?.content || '', config.full ? Infinity : 1000),
      lastUserMessage: truncate(userMessages[userMessages.length - 1]?.content || '', config.full ? Infinity : 500),
      topKeywords,
    },
    userMessages: userMessages.map(m => ({
      content: truncate(m.content, maxLen),
      timestamp: m.timestamp,
    })),
    assistantMessages: assistantMessages.map(m => ({
      content: truncate(m.content, maxLen),
      timestamp: m.timestamp,
    })),
  };

  // 输出 JSON 到 stdout
  console.log(JSON.stringify(output, null, 2));
}

main();
