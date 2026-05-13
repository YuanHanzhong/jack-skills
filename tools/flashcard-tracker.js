#!/usr/bin/env bun

/**
 * 闪卡统计工具 (Flashcard Tracker)
 *
 * 功能：
 * - 扫描 02_DWD/ 下的所有文档
 * - 解析 YAML Front Matter 中的 flashcard 数据
 * - 统计学习进度（已掌握/学习中/需要复习）
 * - 列出可晋级到 DWS 的知识点（连续通过3次）
 * - 支持添加复习记录
 * - 生成统计报告
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

// 配置
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const DWD_DIR = join(PROJECT_ROOT, '02_DWD');
const DAYS_TO_REVIEW = 30;  // 多少天未复习算需要复习
const DAYS_TO_EXPIRE = 90;  // 多少天未复习算过期

/**
 * 递归扫描目录，查找所有 .md 文件
 */
function findMarkdownFiles(dir) {
  const files = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...findMarkdownFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`❌ 读取目录失败: ${dir}`, error.message);
  }

  return files;
}

/**
 * 解析 YAML Front Matter
 */
function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yamlText = match[1];
  const frontMatter = {};

  // 简单的 YAML 解析（足够应对我们的需求）
  let currentKey = null;
  let currentArray = null;
  let indent = 0;

  for (const line of yamlText.split('\n')) {
    // 跳过空行
    if (!line.trim()) continue;

    // 计算缩进
    const lineIndent = line.search(/\S/);

    // 检查是否是键值对
    const keyMatch = line.match(/^(\s*)(\w+):\s*(.*)$/);
    if (keyMatch) {
      const [, spaces, key, value] = keyMatch;
      const keyIndent = spaces.length;

      if (keyIndent === 0) {
        // 顶级键
        currentKey = key;
        if (value) {
          frontMatter[key] = parseValue(value);
          currentArray = null;
        } else {
          frontMatter[key] = {};
          currentArray = null;
        }
      } else if (currentKey && keyIndent === 2) {
        // flashcard 的子键
        if (!frontMatter[currentKey]) frontMatter[currentKey] = {};

        if (key === 'reviews') {
          frontMatter[currentKey][key] = [];
          currentArray = key;
          indent = keyIndent;
        } else {
          frontMatter[currentKey][key] = parseValue(value);
        }
      } else if (currentArray && keyIndent > indent) {
        // reviews 数组项的属性
        if (!frontMatter[currentKey][currentArray].length || keyIndent === indent + 2) {
          frontMatter[currentKey][currentArray].push({});
        }
        const lastItem = frontMatter[currentKey][currentArray][frontMatter[currentKey][currentArray].length - 1];
        lastItem[key] = parseValue(value);
      }
    } else if (line.trim().startsWith('- ') && currentArray) {
      // 数组项开始
      const itemMatch = line.match(/^\s*- (.+)$/);
      if (itemMatch) {
        const [, keyValue] = itemMatch;
        const kvMatch = keyValue.match(/^(\w+):\s*(.+)$/);
        if (kvMatch) {
          const [, key, value] = kvMatch;
          frontMatter[currentKey][currentArray].push({ [key]: parseValue(value) });
        }
      }
    }
  }

  return frontMatter;
}

/**
 * 解析值（去除引号，转换布尔值等）
 */
function parseValue(value) {
  value = value.trim();

  // 去除引号
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // 布尔值
  if (value === 'true') return true;
  if (value === 'false') return false;

  // 数字
  if (/^\d+$/.test(value)) return parseInt(value);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);

  return value;
}

/**
 * 计算连续通过次数
 */
function calculateConsecutivePasses(reviews) {
  if (!reviews || !Array.isArray(reviews) || reviews.length === 0) {
    return 0;
  }

  let count = 0;
  for (let i = reviews.length - 1; i >= 0; i--) {
    if (reviews[i].result === 'pass') {
      count++;
    } else {
      break;
    }
  }

  return count;
}

/**
 * 计算距离最后复习的天数
 */
function daysSinceLastReview(reviews) {
  if (!reviews || !Array.isArray(reviews) || reviews.length === 0) {
    return null;
  }

  const lastReview = reviews[reviews.length - 1];
  if (!lastReview.date) return null;

  const lastDate = new Date(lastReview.date);
  const now = new Date();
  const diffTime = Math.abs(now - lastDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * 检查时间跨度是否满足要求（至少3天）
 */
function checkTimeSpan(reviews) {
  if (!reviews || reviews.length < 3) return false;

  const lastThree = reviews.slice(-3);
  const firstDate = new Date(lastThree[0].date);
  const lastDate = new Date(lastThree[2].date);

  const diffTime = Math.abs(lastDate - firstDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays >= 3;
}

/**
 * 分析闪卡数据
 */
function analyzeFlashcard(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const frontMatter = parseFrontMatter(content);

    if (!frontMatter || !frontMatter.flashcard) {
      return null;
    }

    const flashcard = frontMatter.flashcard;
    const reviews = flashcard.reviews || [];
    const consecutivePasses = calculateConsecutivePasses(reviews);
    const daysSince = daysSinceLastReview(reviews);

    // 判断状态
    let status = 'learning';
    let needsReview = false;
    let promotable = false;

    if (consecutivePasses >= 3 && checkTimeSpan(reviews)) {
      if (daysSince !== null && daysSince <= DAYS_TO_REVIEW) {
        status = 'mastered';
        promotable = true;
      } else if (daysSince > DAYS_TO_REVIEW) {
        needsReview = true;
      }
    } else if (daysSince !== null && daysSince > DAYS_TO_EXPIRE) {
      needsReview = true;
    }

    return {
      file: relative(PROJECT_ROOT, filePath),
      topic: flashcard.topic || '未命名',
      difficulty: flashcard.difficulty || 'medium',
      reviews: reviews.length,
      consecutivePasses,
      daysSince,
      status,
      needsReview,
      promotable,
      flashcard
    };
  } catch (error) {
    console.error(`❌ 解析文件失败: ${filePath}`, error.message);
    return null;
  }
}

/**
 * 统计所有闪卡
 */
function analyzeAllFlashcards() {
  const files = findMarkdownFiles(DWD_DIR);
  const flashcards = [];

  for (const file of files) {
    const result = analyzeFlashcard(file);
    if (result) {
      flashcards.push(result);
    }
  }

  return flashcards;
}

/**
 * 生成统计报告
 */
function generateReport(flashcards, options = {}) {
  const mastered = flashcards.filter(f => f.promotable);
  const learning = flashcards.filter(f => f.status === 'learning' && !f.needsReview);
  const needsReview = flashcards.filter(f => f.needsReview);

  console.log('\n📊 闪卡统计报告');
  console.log('━'.repeat(60));
  console.log(`\n✅ 已掌握（可晋级）: ${mastered.length} 个`);
  console.log(`📚 学习中: ${learning.length} 个`);
  console.log(`⚠️  需要复习: ${needsReview.length} 个`);
  console.log('\n' + '━'.repeat(60));

  // 只显示可晋级的知识点
  if (options.promotable || (!options.review && !options.all)) {
    if (mastered.length > 0) {
      console.log('\n🎯 可晋级到 DWS 的知识点：\n');

      mastered.forEach((card, index) => {
        const stars = '⭐'.repeat(5);
        console.log(`${index + 1}. ${card.topic} (${card.consecutivePasses}/3) ${stars}`);
        console.log(`   文件: ${card.file}`);
        console.log(`   最后复习: ${card.daysSince} 天前\n`);
      });
    } else {
      console.log('\n暂无可晋级的知识点\n');
    }
  }

  // 显示学习中的知识点
  if (options.all) {
    if (learning.length > 0) {
      console.log('\n' + '━'.repeat(60));
      console.log('\n📚 学习中的知识点：\n');

      learning.forEach((card, index) => {
        const stars = '⭐'.repeat(card.consecutivePasses);
        const remaining = 3 - card.consecutivePasses;
        console.log(`${index + 1}. ${card.topic} (${card.consecutivePasses}/3) ${stars}`);
        console.log(`   文件: ${card.file}`);
        if (card.daysSince !== null) {
          console.log(`   最后复习: ${card.daysSince} 天前`);
        }
        console.log(`   提示: 再通过 ${remaining} 次即可晋级\n`);
      });
    }
  }

  // 显示需要复习的知识点
  if (options.review || options.all) {
    if (needsReview.length > 0) {
      console.log('\n' + '━'.repeat(60));
      console.log('\n⚠️  需要复习的知识点：\n');

      needsReview.forEach((card, index) => {
        const expired = card.daysSince > DAYS_TO_EXPIRE ? '(已过期)' : '';
        console.log(`${index + 1}. ${card.topic} ${expired}`);
        console.log(`   文件: ${card.file}`);
        if (card.daysSince !== null) {
          console.log(`   最后复习: ${card.daysSince} 天前\n`);
        }
      });
    } else {
      console.log('\n暂无需要复习的知识点\n');
    }
  }

  console.log('━'.repeat(60) + '\n');
}

/**
 * 添加复习记录
 */
function addReview(filePath, result, notes) {
  try {
    const fullPath = join(PROJECT_ROOT, filePath);
    const content = readFileSync(fullPath, 'utf-8');

    // 解析现有的 front matter
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      console.error('❌ 文件没有 YAML Front Matter');
      return;
    }

    const frontMatter = parseFrontMatter(content);
    if (!frontMatter || !frontMatter.flashcard) {
      console.error('❌ 文件没有 flashcard 数据');
      return;
    }

    // 添加新的复习记录
    if (!frontMatter.flashcard.reviews) {
      frontMatter.flashcard.reviews = [];
    }

    const today = new Date().toISOString().split('T')[0];
    frontMatter.flashcard.reviews.push({
      date: today,
      result: result,
      notes: notes || ''
    });

    // 更新状态
    const consecutivePasses = calculateConsecutivePasses(frontMatter.flashcard.reviews);
    if (consecutivePasses >= 3 && checkTimeSpan(frontMatter.flashcard.reviews)) {
      frontMatter.flashcard.status = 'mastered';
      frontMatter.flashcard.promotable = true;
    } else {
      frontMatter.flashcard.status = 'learning';
      frontMatter.flashcard.promotable = false;
    }

    // 重新生成 YAML
    const newYaml = generateYaml(frontMatter);
    const newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${newYaml}---`);

    // 写回文件
    writeFileSync(fullPath, newContent, 'utf-8');

    console.log(`✅ 已添加复习记录到: ${filePath}`);
    console.log(`   结果: ${result === 'pass' ? '✅ 通过' : '❌ 未通过'}`);
    console.log(`   连续通过: ${consecutivePasses}/3`);

    if (frontMatter.flashcard.promotable) {
      console.log('\n🎉 恭喜！此知识点已达到晋级条件！');
    }
  } catch (error) {
    console.error('❌ 添加复习记录失败:', error.message);
  }
}

/**
 * 生成 YAML 字符串
 */
function generateYaml(obj, indent = 0) {
  let yaml = '';
  const spaces = ' '.repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      yaml += `${spaces}${key}:\n`;
    } else if (Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      for (const item of value) {
        if (typeof item === 'object') {
          const firstKey = Object.keys(item)[0];
          yaml += `${spaces}  - ${firstKey}: ${formatValue(item[firstKey])}\n`;
          for (const [k, v] of Object.entries(item)) {
            if (k !== firstKey) {
              yaml += `${spaces}    ${k}: ${formatValue(v)}\n`;
            }
          }
        } else {
          yaml += `${spaces}  - ${formatValue(item)}\n`;
        }
      }
    } else if (typeof value === 'object') {
      yaml += `${spaces}${key}:\n`;
      yaml += generateYaml(value, indent + 2);
    } else {
      yaml += `${spaces}${key}: ${formatValue(value)}\n`;
    }
  }

  return yaml;
}

/**
 * 格式化值（添加引号等）
 */
function formatValue(value) {
  if (typeof value === 'string') {
    // 如果包含特殊字符或冒号，添加引号
    if (value.includes(':') || value.includes('#') || value.includes('\n')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}

/**
 * 主函数
 */
function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      promotable: { type: 'boolean', short: 'p' },
      review: { type: 'boolean', short: 'r' },
      all: { type: 'boolean', short: 'a' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
闪卡统计工具 (Flashcard Tracker)

用法:
  bun run flashcard                        显示可晋级的知识点
  bun run flashcard --all                  显示所有闪卡统计
  bun run flashcard --promotable           只显示可晋级的知识点
  bun run flashcard --review               只显示需要复习的知识点
  bun run flashcard add <file> <result> [notes]  添加复习记录

参数:
  <file>      文件路径（相对于项目根目录）
  <result>    复习结果 (pass/fail)
  [notes]     可选的复习笔记

示例:
  bun run flashcard
  bun run flashcard --all
  bun run flashcard add 02_DWD/fromGithub/react-hooks.md pass "完全掌握"
    `);
    return;
  }

  // 添加复习记录
  if (positionals[0] === 'add') {
    if (positionals.length < 3) {
      console.error('❌ 用法: flashcard add <file> <result> [notes]');
      process.exit(1);
    }

    const file = positionals[1];
    const result = positionals[2];
    const notes = positionals.slice(3).join(' ');

    if (result !== 'pass' && result !== 'fail') {
      console.error('❌ result 必须是 pass 或 fail');
      process.exit(1);
    }

    addReview(file, result, notes);
    return;
  }

  // 统计报告
  const flashcards = analyzeAllFlashcards();
  generateReport(flashcards, values);
}

// 运行主函数
main();
