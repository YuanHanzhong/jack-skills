#!/usr/bin/env bun

/**
 * Windows Terminal 标题设置工具
 *
 * 功能：
 * - 根据模型名称显示彩色emoji图标（🔴 Opus / 🟢 Sonnet / 🔵 Haiku）
 * - 设置终端标题格式：[图标] [意图]
 *
 * 使用：
 * bun tools/set-terminal-title.js <model-id> <intent>
 *
 * 示例：
 * bun tools/set-terminal-title.js "claude-sonnet-4-5" "代码性能优化"
 * → 🟢 代码性能优化
 */

// 从命令行参数获取模型和意图
const args = process.argv.slice(2);
const modelName = args[0] || 'sonnet';  // 默认 sonnet
const intent = args[1] || 'Claude Code'; // 默认主题

/**
 * 根据模型名称返回对应的彩色emoji图标
 * @param {string} modelId - 模型ID或名称
 * @returns {string} 彩色emoji图标
 */
function getModelIcon(modelId) {
  const normalized = modelId.toLowerCase();

  // 匹配 Opus（最强大） → 🔴 红色
  if (normalized.includes('opus')) return '🔴';

  // 匹配 Sonnet（平衡） → 🟢 绿色
  if (normalized.includes('sonnet')) return '🟢';

  // 匹配 Haiku（最快） → 🔵 蓝色
  if (normalized.includes('haiku')) return '🔵';

  // 降级处理，默认 Sonnet
  return '🟢';
}

/**
 * 精简意图描述（如果过长）
 * @param {string} text - 原始意图文本
 * @param {number} maxLength - 最大长度（默认30）
 * @returns {string} 精简后的意图
 */
function simplifyIntent(text, maxLength = 30) {
  if (text.length <= maxLength) return text;

  // 去除冗余词汇
  const simplified = text
    .replace(/^(帮我|请|能否|可以|想要|希望)/g, '')
    .replace(/(的|了|吗|呢)$/g, '')
    .trim();

  // 如果仍然过长，截断并添加省略号
  if (simplified.length > maxLength) {
    return simplified.substring(0, maxLength - 1) + '…';
  }

  return simplified;
}

// 获取图标
const icon = getModelIcon(modelName);

// 精简意图（如果需要）
const simplifiedIntent = simplifyIntent(intent);

// 设置终端标题（ANSI 转义序列）
// \x1b]0; 开始标题设置
// \x07 结束标题设置
const title = `${icon} ${simplifiedIntent}`;
process.stdout.write(`\x1b]0;${title}\x07`);

// 可选：输出调试信息（注释掉以避免干扰终端输出）
// console.error(`[set-terminal-title] ${title}`);

// 返回成功
process.exit(0);
