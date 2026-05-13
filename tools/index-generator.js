#!/usr/bin/env bun

/**
 * index-generator.js
 * 为知识管理系统生成索引文件
 * - 为 03_DWS/INDEX.md 生成多维度索引（时间、领域、项目）
 * - 为 04_ADS/INDEX.md 生成按状态的看板
 */

import { glob } from 'glob';
import matter from 'gray-matter';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, relative, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

/**
 * 确保目录存在（智能创建，避免无意义错误）
 * @param {string} dirPath - 目录路径
 */
function ensureDirectoryExists(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 安全写入文件（确保目录存在）
 * @param {string} filePath - 文件路径
 * @param {string} content - 文件内容
 */
function safeWriteFile(filePath, content) {
  const dir = dirname(filePath);
  ensureDirectoryExists(dir);
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * 读取并解析 Markdown 文件
 * @param {string} filePath - 文件路径
 * @returns {Object|null} - 包含 frontmatter 和文件信息的对象
 */
function parseMarkdownFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const { data, content: markdownContent } = matter(content);

    return {
      path: filePath,
      relativePath: relative(ROOT_DIR, filePath).replace(/\\/g, '/'),
      frontmatter: data,
      content: markdownContent,
      title: data.title || extractTitleFromContent(markdownContent) || '未命名',
      date: String(data.date || extractDateFromPath(filePath) || new Date().toISOString().split('T')[0]),
      tags: data.tags || [],
      domain: data.domain || data.领域 || '未分类',
      project: data.project || data.项目 || null,
      status: data.status || data.状态 || null,
    };
  } catch (error) {
    console.error(`解析文件失败: ${filePath}`, error.message);
    return null;
  }
}

/**
 * 从内容中提取标题（第一个 # 标题）
 * @param {string} content - Markdown 内容
 * @returns {string|null} - 提取的标题
 */
function extractTitleFromContent(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * 从文件路径中提取日期（如果路径包含日期格式）
 * @param {string} filePath - 文件路径
 * @returns {string|null} - 提取的日期
 */
function extractDateFromPath(filePath) {
  const dateMatch = filePath.match(/(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : null;
}

/**
 * 生成 03_DWS 的多维度索引
 * @param {Array} files - 解析后的文件列表
 * @returns {string} - 生成的 Markdown 内容
 */
function generateDWSIndex(files) {
  const now = new Date().toISOString().split('T')[0];

  let markdown = `---
title: 知识索引（主题层）
generated: ${now}
---

# 知识索引（主题层）

> 本文件由 \`bun run index\` 自动生成，最后更新：${now}

`;

  // 按时间倒序排列
  markdown += '## 按时间索引\n\n';
  const byDate = files.sort((a, b) => b.date.localeCompare(a.date));
  byDate.forEach(file => {
    markdown += `- **${file.date}** - [${file.title}](${file.relativePath})\n`;
  });
  markdown += '\n';

  // 按领域分组
  markdown += '## 按领域索引\n\n';
  const byDomain = groupBy(files, 'domain');
  Object.keys(byDomain).sort().forEach(domain => {
    markdown += `### ${domain}\n\n`;
    byDomain[domain].forEach(file => {
      markdown += `- [${file.title}](${file.relativePath})\n`;
    });
    markdown += '\n';
  });

  // 按项目分组
  markdown += '## 按项目索引\n\n';
  const byProject = groupBy(files.filter(f => f.project), 'project');
  if (Object.keys(byProject).length === 0) {
    markdown += '暂无项目关联的知识\n\n';
  } else {
    Object.keys(byProject).sort().forEach(project => {
      markdown += `### ${project}\n\n`;
      byProject[project].forEach(file => {
        markdown += `- [${file.title}](${file.relativePath})\n`;
      });
      markdown += '\n';
    });
  }

  // 标签云
  markdown += '## 标签云\n\n';
  const tagCount = {};
  files.forEach(file => {
    file.tags.forEach(tag => {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
  });
  const sortedTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);
  if (sortedTags.length === 0) {
    markdown += '暂无标签\n\n';
  } else {
    sortedTags.forEach(([tag, count]) => {
      markdown += `- **${tag}** (${count})\n`;
    });
    markdown += '\n';
  }

  markdown += `---\n\n共 ${files.length} 个知识主题\n`;

  return markdown;
}

/**
 * 生成 04_ADS 的看板式索引
 * @param {Array} files - 解析后的文件列表
 * @returns {string} - 生成的 Markdown 内容
 */
function generateADSIndex(files) {
  const now = new Date().toISOString().split('T')[0];

  let markdown = `---
title: 项目看板（应用层）
generated: ${now}
---

# 项目看板（应用层）

> 本文件由 \`bun run index\` 自动生成，最后更新：${now}

`;

  // 按状态分组
  const statusOrder = ['1_收集', '2_进行中', '3_已完成'];
  const statusLabels = {
    '1_收集': '收集箱',
    '2_进行中': '进行中',
    '3_已完成': '已完成'
  };

  statusOrder.forEach(status => {
    const label = statusLabels[status];
    markdown += `## ${label}\n\n`;

    const statusFiles = files.filter(f => {
      // 检查 frontmatter 中的 status 或从路径推断
      if (f.status === status || f.status === label) return true;
      return f.relativePath.includes(`04_ADS/${status}`);
    });

    if (statusFiles.length === 0) {
      markdown += '暂无项目\n\n';
    } else {
      statusFiles.forEach(file => {
        const tags = file.tags.length > 0 ? ` \`${file.tags.join('` `')}\`` : '';
        const project = file.project ? ` [项目: ${file.project}]` : '';
        markdown += `- [${file.title}](${file.relativePath})${tags}${project}\n`;
        if (file.frontmatter.deadline) {
          markdown += `  - 截止日期: ${file.frontmatter.deadline}\n`;
        }
        if (file.frontmatter.priority) {
          markdown += `  - 优先级: ${file.frontmatter.priority}\n`;
        }
      });
      markdown += '\n';
    }
  });

  // 统计
  markdown += '## 统计\n\n';
  const stats = {
    total: files.length,
    collecting: files.filter(f => f.relativePath.includes('1_收集')).length,
    inProgress: files.filter(f => f.relativePath.includes('2_进行中')).length,
    completed: files.filter(f => f.relativePath.includes('3_已完成')).length,
  };

  markdown += `- 总计: ${stats.total} 个项目\n`;
  markdown += `- 收集箱: ${stats.collecting} 个\n`;
  markdown += `- 进行中: ${stats.inProgress} 个\n`;
  markdown += `- 已完成: ${stats.completed} 个\n`;

  if (stats.total > 0) {
    const completionRate = ((stats.completed / stats.total) * 100).toFixed(1);
    markdown += `- 完成率: ${completionRate}%\n`;
  }

  return markdown;
}

/**
 * 辅助函数：按字段分组
 * @param {Array} array - 数组
 * @param {string} key - 分组键
 * @returns {Object} - 分组后的对象
 */
function groupBy(array, key) {
  return array.reduce((result, item) => {
    const group = item[key] || '未分类';
    if (!result[group]) {
      result[group] = [];
    }
    result[group].push(item);
    return result;
  }, {});
}

/**
 * 主函数
 */
async function main() {
  console.log('开始生成索引...\n');

  // 生成 03_DWS 索引
  console.log('正在扫描 03_DWS 目录...');
  const dwsPattern = join(ROOT_DIR, '03_DWS', '**', '*.md');
  const dwsFiles = await glob(dwsPattern, {
    ignore: ['**/INDEX.md', '**/node_modules/**'],
    windowsPathsNoEscape: true
  });

  const dwsParsed = dwsFiles
    .map(parseMarkdownFile)
    .filter(f => f !== null);

  console.log(`找到 ${dwsParsed.length} 个知识文件`);

  const dwsIndex = generateDWSIndex(dwsParsed);
  const dwsIndexPath = join(ROOT_DIR, '03_DWS', 'INDEX.md');
  safeWriteFile(dwsIndexPath, dwsIndex);
  console.log(`✓ 已生成: ${dwsIndexPath}\n`);

  // 生成 04_ADS 索引
  console.log('正在扫描 04_ADS 目录...');
  const adsPattern = join(ROOT_DIR, '04_ADS', '**', '*.md');
  const adsFiles = await glob(adsPattern, {
    ignore: ['**/INDEX.md', '**/node_modules/**'],
    windowsPathsNoEscape: true
  });

  const adsParsed = adsFiles
    .map(parseMarkdownFile)
    .filter(f => f !== null);

  console.log(`找到 ${adsParsed.length} 个项目文件`);

  const adsIndex = generateADSIndex(adsParsed);
  const adsIndexPath = join(ROOT_DIR, '04_ADS', 'INDEX.md');
  safeWriteFile(adsIndexPath, adsIndex);
  console.log(`✓ 已生成: ${adsIndexPath}\n`);

  // 生成 00_DIM 索引
  console.log('正在生成 00_DIM 索引...');
  const dimIndex = await generateDIMIndex();
  const dimIndexPath = join(ROOT_DIR, '00_DIM', 'INDEX.md');
  safeWriteFile(dimIndexPath, dimIndex);
  console.log(`✓ 已生成: ${dimIndexPath}\n`);

  // 验证 CLAUDE.md 索引覆盖率
  console.log('正在检查 CLAUDE.md 规则索引覆盖率...');
  try {
    const { generateIndexReport } = await import('./validators/index-validator.js');
    const indexReport = await generateIndexReport(ROOT_DIR);
    console.log(indexReport);
  } catch (error) {
    console.log('⚠️  索引验证器不可用，跳过验证');
  }

  console.log('索引生成完成！');
}

/**
 * 生成 00_DIM 的索引
 * @returns {string} - 生成的 Markdown 内容
 */
async function generateDIMIndex() {
  const now = new Date().toISOString().split('T')[0];

  let markdown = `---
title: 元数据层索引（DIM）
generated: ${now}
---

# 元数据层索引（DIM）

> 本文件由 \`bun run index\` 自动生成，最后更新：${now}

## 📁 目录结构

\`\`\`
00_DIM/
├── rules/        # 规则文档（稳定，修改需确认）
├── templates/    # 文档模板
├── standards/    # 标准定义
└── memory.md     # 项目记忆（动态，自动维护）
\`\`\`

`;

  // 扫描规则文档
  const rulesDir = join(ROOT_DIR, '00_DIM', 'rules');
  let ruleFiles = [];
  if (existsSync(rulesDir)) {
    ruleFiles = await glob(join(rulesDir, '*.md'), { windowsPathsNoEscape: true });
  } else {
    console.log('⚠️  规则目录不存在，已自动创建：00_DIM/rules/');
    ensureDirectoryExists(rulesDir);
  }

  markdown += '## 📋 规则文档\n\n';

  if (ruleFiles.length === 0) {
    markdown += '暂无规则文档\n\n';
  } else {
    // 读取每个规则文件的标题
    const rules = [];
    for (const filePath of ruleFiles) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const { data } = matter(content);
        const fileName = relative(ROOT_DIR, filePath).replace(/\\/g, '/');
        const title = data.title || extractTitleFromContent(content) || basename(filePath, '.md');
        rules.push({ fileName, title, filePath });
      } catch (error) {
        console.error(`读取规则文件失败: ${filePath}`, error.message);
      }
    }

    // 按文件名排序
    rules.sort((a, b) => a.fileName.localeCompare(b.fileName));

    for (const rule of rules) {
      markdown += `- [${rule.title}](${rule.fileName})\n`;
    }
    markdown += '\n';
  }

  // 扫描模板文档
  const templatesDir = join(ROOT_DIR, '00_DIM', 'templates');
  let templateFiles = [];
  if (existsSync(templatesDir)) {
    templateFiles = await glob(join(templatesDir, '*.md'), { windowsPathsNoEscape: true });
  } else {
    console.log('⚠️  模板目录不存在，已自动创建：00_DIM/templates/');
    ensureDirectoryExists(templatesDir);
  }

  markdown += '## 📝 模板文档\n\n';

  if (templateFiles.length === 0) {
    markdown += '暂无模板文档\n\n';
  } else {
    const templates = [];
    for (const filePath of templateFiles) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const { data } = matter(content);
        const fileName = relative(ROOT_DIR, filePath).replace(/\\/g, '/');
        const title = data.title || extractTitleFromContent(content) || basename(filePath, '.md');
        templates.push({ fileName, title });
      } catch (error) {
        console.error(`读取模板文件失败: ${filePath}`, error.message);
      }
    }

    templates.sort((a, b) => a.fileName.localeCompare(b.fileName));

    for (const template of templates) {
      markdown += `- [${template.title}](${template.fileName})\n`;
    }
    markdown += '\n';
  }

  // 扫描标准定义
  const standardsDir = join(ROOT_DIR, '00_DIM', 'standards');
  let standardFiles = [];
  if (existsSync(standardsDir)) {
    standardFiles = await glob(join(standardsDir, '*.md'), { windowsPathsNoEscape: true });
  } else {
    console.log('⚠️  标准目录不存在，已自动创建：00_DIM/standards/');
    ensureDirectoryExists(standardsDir);
  }

  markdown += '## 📊 标准定义\n\n';

  if (standardFiles.length === 0) {
    markdown += '暂无标准定义\n\n';
  } else {
    const standards = [];
    for (const filePath of standardFiles) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const { data } = matter(content);
        const fileName = relative(ROOT_DIR, filePath).replace(/\\/g, '/');
        const title = data.title || extractTitleFromContent(content) || basename(filePath, '.md');
        standards.push({ fileName, title });
      } catch (error) {
        console.error(`读取标准文件失败: ${filePath}`, error.message);
      }
    }

    standards.sort((a, b) => a.fileName.localeCompare(b.fileName));

    for (const standard of standards) {
      markdown += `- [${standard.title}](${standard.fileName})\n`;
    }
    markdown += '\n';
  }

  markdown += `---\n\n共 ${ruleFiles.length + templateFiles.length + standardFiles.length} 个元数据文档\n`;

  return markdown;
}

// 运行主函数
main().catch(console.error);
