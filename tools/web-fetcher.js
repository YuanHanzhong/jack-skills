#!/usr/bin/env bun

/**
 * web-fetcher.js
 * 抓取网页内容并转换为 Markdown 格式
 * 支持指定来源类型，自动保存到对应目录并添加 YAML Front Matter
 *
 * 使用方法:
 *   bun run fetch <URL> [来源类型]
 *   来源类型: github | article | book | video (默认: article)
 *
 * 示例:
 *   bun run fetch https://github.com/example/repo github
 *   bun run fetch https://blog.example.com/post article
 */

import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { createHash } from 'crypto';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// 来源类型映射
const SOURCE_TYPES = {
  github: 'fromGithub',
  article: 'fromArticle',
  book: 'fromBook',
  video: 'fromVideo',
};

/**
 * 初始化 Turndown 服务
 * @returns {TurndownService} - 配置好的 Turndown 实例
 */
function initTurndown() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  // 保留某些 HTML 标签
  turndown.keep(['iframe', 'video', 'audio']);

  // 自定义规则：移除脚本和样式
  turndown.remove(['script', 'style', 'noscript']);

  return turndown;
}

/**
 * 抓取网页内容
 * @param {string} url - 网页 URL
 * @returns {Promise<Object>} - 包含标题、内容等信息的对象
 */
async function fetchWebpage(url) {
  console.log(`正在抓取: ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} (${url})`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 提取元数据
    const title = $('title').text().trim() ||
                  $('h1').first().text().trim() ||
                  $('meta[property="og:title"]').attr('content') ||
                  '未命名';

    const description = $('meta[name="description"]').attr('content') ||
                       $('meta[property="og:description"]').attr('content') ||
                       '';

    const author = $('meta[name="author"]').attr('content') ||
                  $('meta[property="article:author"]').attr('content') ||
                  '';

    // 提取主要内容区域
    let mainContent = '';

    // 尝试常见的内容选择器
    const contentSelectors = [
      'article',
      'main',
      '.markdown-body',  // GitHub
      '.post-content',
      '.entry-content',
      '.article-content',
      '.content',
      '#content',
      'body',
    ];

    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        // 移除导航、侧边栏、页脚等
        element.find('nav, aside, footer, .sidebar, .navigation, .comments').remove();
        mainContent = element.html() || '';
        if (mainContent.length > 100) {
          break;
        }
      }
    }

    if (!mainContent) {
      mainContent = $('body').html() || '';
    }

    return {
      title,
      description,
      author,
      html: mainContent,
      url,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`抓取超时（>15s）: ${url}`);
    }
    console.error(`抓取失败 (${url}):`, error.message);
    throw error;
  }
}

/**
 * 将 HTML 转换为 Markdown
 * @param {string} html - HTML 内容
 * @param {TurndownService} turndown - Turndown 实例
 * @returns {string} - Markdown 内容
 */
function htmlToMarkdown(html, turndown) {
  return turndown.turndown(html);
}

/**
 * 生成文件名（从标题或 URL 生成）
 * @param {string} title - 标题
 * @param {string} url - URL
 * @returns {string} - 文件名
 */
function generateFilename(title, url) {
  // 清理标题，移除特殊字符
  let filename = title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')  // 移除非法字符
    .replace(/\s+/g, '-')  // 空格替换为连字符
    .replace(/\.+$/, '')   // 移除末尾的点
    .toLowerCase();

  // 如果标题太短或无效，使用 URL 的一部分
  if (filename.length < 3) {
    const urlParts = new URL(url).pathname.split('/').filter(p => p);
    filename = urlParts[urlParts.length - 1] || 'untitled';
  }

  // 限制长度
  if (filename.length > 100) {
    filename = filename.substring(0, 100);
  }

  // 添加日期前缀
  const date = new Date().toISOString().split('T')[0];
  filename = `${date}-${filename}`;

  return `${filename}.md`;
}

/**
 * 生成 YAML Front Matter
 * @param {Object} metadata - 元数据
 * @param {string} sourceType - 来源类型
 * @returns {string} - YAML Front Matter 字符串
 */
export function generateFrontMatter(metadata, sourceType, bodyContent = '') {
  const date = new Date().toISOString().split('T')[0];
  const hash = createHash('sha256').update(bodyContent.trimStart(), 'utf-8').digest('hex');
  const lines = ['---'];

  lines.push(`title: "${metadata.title.replace(/"/g, '\\"')}"`);
  lines.push(`source: ${sourceType}`);
  lines.push(`url: ${metadata.url}`);
  lines.push(`source_url: ${metadata.url}`);
  lines.push(`date: ${date}`);
  lines.push(`ingested: ${date}`);
  lines.push(`sha256: ${hash}`);

  if (metadata.author) {
    lines.push(`author: "${metadata.author.replace(/"/g, '\\"')}"`);
  }

  if (metadata.description) {
    lines.push(`description: "${metadata.description.replace(/"/g, '\\"')}"`);
  }

  lines.push(`tags: []`);
  lines.push(`---`);
  lines.push('');

  return lines.join('\n');
}

/**
 * 保存 Markdown 文件
 * @param {string} content - Markdown 内容
 * @param {string} filename - 文件名
 * @param {string} sourceType - 来源类型
 * @returns {string} - 保存的文件路径
 */
function saveMarkdown(content, filename, sourceType) {
  const targetDir = join(ROOT_DIR, '01_ODS', SOURCE_TYPES[sourceType]);

  // 确保目录存在
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const filePath = join(targetDir, filename);

  // 检查文件是否已存在
  if (existsSync(filePath)) {
    const timestamp = Date.now();
    const parts = filename.split('.');
    const ext = parts.pop();
    const base = parts.join('.');
    filename = `${base}-${timestamp}.${ext}`;
  }

  const fullPath = join(targetDir, filename);
  writeFileSync(fullPath, content, 'utf-8');

  return fullPath;
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(`
使用方法:
  bun run fetch <URL> [来源类型]

来源类型 (可选):
  github  - GitHub 仓库或文档
  article - 文章或博客 (默认)
  book    - 书籍或电子书章节
  video   - 视频或教程

示例:
  bun run fetch https://github.com/example/repo github
  bun run fetch https://blog.example.com/post article
  bun run fetch https://www.youtube.com/watch?v=xxxxx video
    `);
    process.exit(1);
  }

  const url = args[0];
  const sourceType = args[1] || 'article';

  // 验证来源类型
  if (!SOURCE_TYPES[sourceType]) {
    console.error(`错误: 无效的来源类型 "${sourceType}"`);
    console.error(`支持的类型: ${Object.keys(SOURCE_TYPES).join(', ')}`);
    process.exit(1);
  }

  // 验证 URL
  try {
    new URL(url);
  } catch {
    console.error('错误: 无效的 URL');
    process.exit(1);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`抓取网页内容`);
  console.log('='.repeat(60));
  console.log(`URL: ${url}`);
  console.log(`来源类型: ${sourceType}`);
  console.log('');

  try {
    // 抓取网页
    const webpage = await fetchWebpage(url);
    console.log(`✓ 抓取成功: ${webpage.title}`);

    // 转换为 Markdown
    const turndown = initTurndown();
    const markdown = htmlToMarkdown(webpage.html, turndown);
    console.log(`✓ 转换完成 (${markdown.length} 字符)`);

    // 生成完整内容
    const frontMatter = generateFrontMatter(webpage, sourceType, markdown);
    const fullContent = frontMatter + markdown;

    // 保存文件
    const filename = generateFilename(webpage.title, url);
    const savedPath = saveMarkdown(fullContent, filename, sourceType);

    console.log('');
    console.log('='.repeat(60));
    console.log(`✓ 保存成功!`);
    console.log('='.repeat(60));
    console.log(`文件路径: ${savedPath}`);
    console.log(`文件大小: ${(fullContent.length / 1024).toFixed(2)} KB`);
    console.log('');
    console.log('提示: 您可能需要手动编辑文件以添加标签或调整内容');
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('错误: 处理失败');
    console.error('='.repeat(60));
    console.error(error.message);
    process.exit(1);
  }
}

// 运行主函数
if (import.meta.main) {
  main();
}
