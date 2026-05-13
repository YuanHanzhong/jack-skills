#!/usr/bin/env bun

/**
 * 全文搜索工具
 *
 * 功能：
 * 1. 支持按关键词搜索所有层的文档
 * 2. 支持按层级过滤（--layer=ODS/DWD/DWS/ADS）
 * 3. 支持按来源类型过滤（--type=fromGithub/fromArticle等）
 * 4. 显示搜索结果的上下文
 *
 * 使用示例：
 *   bun run search "React Hooks"
 *   bun run search "React Hooks" --layer=DWD
 *   bun run search "React Hooks" --type=fromArticle
 *   bun run search "React Hooks" --layer=DWD --type=fromArticle
 */

import { glob } from 'glob';
import { readFileSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

// 获取项目根目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);

  // 如果没有参数，显示帮助
  if (args.length === 0) {
    showHelp();
    process.exit(0);
  }

  const config = {
    keyword: null,
    layer: null,
    type: null,
    contextLines: 2, // 显示上下文的行数
  };

  // 提取关键词（第一个非选项参数）
  for (const arg of args) {
    if (!arg.startsWith('--')) {
      config.keyword = arg;
      break;
    }
  }

  // 提取选项
  for (const arg of args) {
    if (arg.startsWith('--layer=')) {
      config.layer = arg.split('=')[1].toUpperCase();
    } else if (arg.startsWith('--type=')) {
      config.type = arg.split('=')[1];
    } else if (arg.startsWith('--context=')) {
      config.contextLines = parseInt(arg.split('=')[1]);
    }
  }

  if (!config.keyword) {
    console.error('错误：必须提供搜索关键词');
    showHelp();
    process.exit(1);
  }

  return config;
}

// 显示帮助信息
function showHelp() {
  console.log(`
全文搜索工具

使用方法：
  bun run search <关键词> [选项]

选项：
  --layer=<层级>      按层级过滤（ODS/DWD/DWS/ADS）
  --type=<类型>       按来源类型过滤（fromGithub/fromArticle/fromBook/fromVideo）
  --context=<行数>    显示上下文的行数（默认: 2）

示例：
  bun run search "React Hooks"
  bun run search "React Hooks" --layer=DWD
  bun run search "React Hooks" --type=fromArticle
  bun run search "React Hooks" --layer=DWD --type=fromArticle --context=3
  `);
}

// 获取搜索路径
function getSearchPattern(config) {
  const patterns = [];

  if (config.layer) {
    // 根据层级过滤
    const layerMap = {
      'ODS': '01_ODS',
      'DWD': '02_DWD',
      'DWS': '03_DWS',
      'ADS': '04_ADS',
      'DIM': '00_DIM',
    };

    const layerDir = layerMap[config.layer];
    if (!layerDir) {
      console.error(`错误：无效的层级 "${config.layer}". 可用层级: ODS, DWD, DWS, ADS, DIM`);
      process.exit(1);
    }

    if (config.type) {
      // 层级 + 类型
      patterns.push(`${layerDir}/${config.type}/**/*.md`);
    } else {
      // 仅层级
      patterns.push(`${layerDir}/**/*.md`);
    }
  } else if (config.type) {
    // 仅类型（搜索所有层级中的该类型）
    patterns.push(`0*_*/${config.type}/**/*.md`);
  } else {
    // 搜索所有文档
    patterns.push('0*_*/**/*.md');
  }

  return patterns;
}

// 搜索文件内容
function searchInFile(filePath, keyword, contextLines) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const matches = [];

    // 解析 Front Matter（如果存在）
    let frontMatter = null;
    try {
      const parsed = matter(content);
      frontMatter = parsed.data;
    } catch {
      // Front Matter 缺失或格式错误时跳过，不影响正文搜索
    }

    // 搜索每一行
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.toLowerCase().includes(keyword.toLowerCase())) {
        // 获取上下文
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length - 1, i + contextLines);

        const context = {
          lineNumber: i + 1,
          matchLine: line,
          before: lines.slice(start, i),
          after: lines.slice(i + 1, end + 1),
        };

        matches.push(context);
      }
    }

    return {
      filePath,
      frontMatter,
      matches,
    };
  } catch (error) {
    console.error(`读取文件失败 ${filePath}:`, error.message);
    return null;
  }
}

// 转义 RegExp 特殊字符，防止 ReDoS
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 高亮显示关键词
function highlightKeyword(text, keyword) {
  const regex = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
  return text.replace(regex, '\x1b[33m$1\x1b[0m'); // 黄色高亮
}

// 显示搜索结果
function displayResults(results, keyword) {
  if (results.length === 0) {
    console.log('\n没有找到匹配的结果。\n');
    return;
  }

  console.log(`\n找到 ${results.length} 个文件包含 "${keyword}":\n`);

  for (const result of results) {
    const relativePath = relative(rootDir, result.filePath);
    console.log(`\x1b[36m${relativePath}\x1b[0m`); // 青色文件路径

    // 显示 Front Matter 信息（如果存在）
    if (result.frontMatter) {
      const tags = result.frontMatter.tags || result.frontMatter.标签;
      const category = result.frontMatter.category || result.frontMatter.类型;

      if (tags || category) {
        let info = '  ';
        if (category) info += `[${category}] `;
        if (tags) info += `标签: ${Array.isArray(tags) ? tags.join(', ') : tags}`;
        console.log(`\x1b[90m${info}\x1b[0m`); // 灰色元信息
      }
    }

    // 显示每个匹配
    for (const match of result.matches) {
      console.log(`\x1b[32m  第 ${match.lineNumber} 行:\x1b[0m`); // 绿色行号

      // 显示上文
      if (match.before.length > 0) {
        for (const line of match.before) {
          console.log(`\x1b[90m    ${line}\x1b[0m`); // 灰色上文
        }
      }

      // 显示匹配行（高亮关键词）
      console.log(`    ${highlightKeyword(match.matchLine, keyword)}`);

      // 显示下文
      if (match.after.length > 0) {
        for (const line of match.after) {
          console.log(`\x1b[90m    ${line}\x1b[0m`); // 灰色下文
        }
      }

      console.log(''); // 空行分隔
    }
  }

  // 统计信息
  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);
  console.log(`\x1b[1m总计: ${results.length} 个文件，${totalMatches} 处匹配\x1b[0m\n`);
}

// 主函数
async function main() {
  console.log('\x1b[1m搜索中...\x1b[0m\n');

  const config = parseArgs();
  const patterns = getSearchPattern(config);

  // 搜索文件
  const allFiles = [];
  for (const pattern of patterns) {
    const files = await glob(pattern, {
      cwd: rootDir,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });
    allFiles.push(...files);
  }

  // 去重
  const uniqueFiles = [...new Set(allFiles)];

  if (uniqueFiles.length === 0) {
    console.log('没有找到符合条件的文件。\n');
    return;
  }

  // 在每个文件中搜索
  const results = [];
  for (const file of uniqueFiles) {
    const result = searchInFile(file, config.keyword, config.contextLines);
    if (result && result.matches.length > 0) {
      results.push(result);
    }
  }

  // 显示结果
  displayResults(results, config.keyword);
}

// 运行主函数
main().catch(error => {
  console.error('搜索失败:', error);
  process.exit(1);
});
