#!/usr/bin/env node

/**
 * Claude Code 洞察报告生成器
 *
 * 分析 usage-data 中的会话数据，生成中英文双语洞察报告
 *
 * 用法：
 *   bun run tools/jinsights-analyzer.js 1d    # 最近 24 小时
 *   bun run tools/jinsights-analyzer.js 7d    # 最近 7 天
 *   bun run tools/jinsights-analyzer.js 30d   # 最近 30 天
 *   bun run tools/jinsights-analyzer.js all   # 全部历史
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { platform } from 'os';

// 时间范围定义（毫秒）
const TIME_RANGES = {
  '1d': 24 * 60 * 60 * 1000,         // 24 小时
  '7d': 7 * 24 * 60 * 60 * 1000,     // 7 天
  '30d': 30 * 24 * 60 * 60 * 1000,   // 30 天
  'all': Infinity                     // 全部
};

// 时间范围中文描述
const RANGE_NAMES_ZH = {
  '1d': '最近 24 小时',
  '7d': '最近 7 天',
  '30d': '最近 30 天',
  'all': '全部历史'
};

// 时间范围英文描述
const RANGE_NAMES_EN = {
  '1d': 'Last 24 Hours',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  'all': 'All Time'
};

/**
 * 读取 JSON 文件
 */
function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`读取文件失败: ${filePath}`, error.message);
    return null;
  }
}

/**
 * 读取目录下所有 JSON 文件
 */
function readAllJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.error(`目录不存在: ${dirPath}`);
    return [];
  }

  const files = fs.readdirSync(dirPath);
  const jsonData = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(dirPath, file);
    const data = readJsonFile(filePath);
    if (data) {
      jsonData.push(data);
    }
  }

  return jsonData;
}

/**
 * 按时间范围过滤会话
 */
function filterByTimeRange(sessions, rangeMs) {
  const now = Date.now();
  const cutoff = now - rangeMs;

  return sessions.filter(session => {
    if (!session.start_time) return false;
    const startTime = new Date(session.start_time).getTime();
    return startTime >= cutoff;
  });
}

/**
 * 合并 session-meta 和 facets 数据
 */
function mergeSessions(sessionMetas, facets) {
  const facetsMap = new Map();
  facets.forEach(facet => {
    if (facet.session_id) {
      facetsMap.set(facet.session_id, facet);
    }
  });

  return sessionMetas.map(meta => ({
    ...meta,
    facet: facetsMap.get(meta.session_id) || {}
  }));
}

/**
 * 汇总统计数据
 */
function calculateStats(sessions) {
  const stats = {
    sessionCount: sessions.length,
    totalDuration: 0,
    inputTokens: 0,
    outputTokens: 0,
    linesAdded: 0,
    linesRemoved: 0,
    filesModified: 0,
    gitCommits: 0,
    toolCounts: {},
    languages: {},
    projects: {},
    goalCategories: {},
    outcomes: {},
    sessionTypes: {},
    earliestSession: null,
    latestSession: null
  };

  if (sessions.length === 0) return stats;

  for (const session of sessions) {
    // 基础统计
    stats.totalDuration += session.duration_minutes || 0;
    stats.inputTokens += session.input_tokens || 0;
    stats.outputTokens += session.output_tokens || 0;
    stats.linesAdded += session.lines_added || 0;
    stats.linesRemoved += session.lines_removed || 0;
    stats.filesModified += session.files_modified || 0;
    stats.gitCommits += session.git_commits || 0;

    // 工具使用统计
    if (session.tool_counts) {
      for (const [tool, count] of Object.entries(session.tool_counts)) {
        stats.toolCounts[tool] = (stats.toolCounts[tool] || 0) + count;
      }
    }

    // 编程语言统计
    if (session.languages) {
      for (const [lang, count] of Object.entries(session.languages)) {
        stats.languages[lang] = (stats.languages[lang] || 0) + count;
      }
    }

    // 项目统计
    if (session.project_path) {
      const projectName = path.basename(session.project_path);
      stats.projects[projectName] = (stats.projects[projectName] || 0) + 1;
    }

    // 目标分类统计
    if (session.facet?.goal_categories) {
      for (const [category, count] of Object.entries(session.facet.goal_categories)) {
        stats.goalCategories[category] = (stats.goalCategories[category] || 0) + count;
      }
    }

    // 结果统计
    if (session.facet?.outcome) {
      stats.outcomes[session.facet.outcome] = (stats.outcomes[session.facet.outcome] || 0) + 1;
    }

    // 会话类型统计
    if (session.facet?.session_type) {
      stats.sessionTypes[session.facet.session_type] = (stats.sessionTypes[session.facet.session_type] || 0) + 1;
    }

    // 时间范围
    const startTime = new Date(session.start_time);
    if (!stats.earliestSession || startTime < stats.earliestSession) {
      stats.earliestSession = startTime;
    }
    if (!stats.latestSession || startTime > stats.latestSession) {
      stats.latestSession = startTime;
    }
  }

  return stats;
}

/**
 * 格式化时长
 */
function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours === 0) return `${mins} 分钟`;
  return `${hours} 小时 ${mins} 分钟`;
}

/**
 * 格式化数字（千分位）
 */
function formatNumber(num) {
  return num.toLocaleString('zh-CN');
}

/**
 * 格式化百分比
 */
function formatPercent(value, total) {
  if (total === 0) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * 生成中文报告
 */
function generateChineseReport(stats, range) {
  const avgDuration = stats.sessionCount > 0 ? stats.totalDuration / stats.sessionCount : 0;

  let report = `# Claude Code 洞察报告 - ${RANGE_NAMES_ZH[range]}\n\n`;
  report += `> 生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n`;

  // 会话概览
  report += `## 📊 会话概览\n\n`;
  report += `- **会话数量**：${stats.sessionCount} 个\n`;
  report += `- **总对话时长**：${formatDuration(stats.totalDuration)}\n`;
  report += `- **平均会话时长**：${formatDuration(avgDuration)}\n`;
  report += `- **Token 使用量**：输入 ${formatNumber(stats.inputTokens)} / 输出 ${formatNumber(stats.outputTokens)}\n\n`;

  // 核心目标分析
  if (Object.keys(stats.goalCategories).length > 0) {
    report += `## 🎯 核心目标分析\n\n`;
    const totalGoals = Object.values(stats.goalCategories).reduce((a, b) => a + b, 0);
    const sortedGoals = Object.entries(stats.goalCategories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    report += `| 目标类别 | 次数 | 占比 |\n`;
    report += `|---------|------|------|\n`;
    for (const [category, count] of sortedGoals) {
      report += `| ${category} | ${count} | ${formatPercent(count, totalGoals)} |\n`;
    }
    report += `\n`;
  }

  // 结果统计
  if (Object.keys(stats.outcomes).length > 0) {
    report += `### 目标完成率\n\n`;
    const totalOutcomes = Object.values(stats.outcomes).reduce((a, b) => a + b, 0);
    const sortedOutcomes = Object.entries(stats.outcomes)
      .sort((a, b) => b[1] - a[1]);

    report += `| 结果 | 次数 | 占比 |\n`;
    report += `|------|------|------|\n`;
    for (const [outcome, count] of sortedOutcomes) {
      report += `| ${outcome} | ${count} | ${formatPercent(count, totalOutcomes)} |\n`;
    }
    report += `\n`;
  }

  // 产出统计
  report += `## 📈 产出统计\n\n`;
  report += `- **代码添加**：${formatNumber(stats.linesAdded)} 行\n`;
  report += `- **代码删除**：${formatNumber(stats.linesRemoved)} 行\n`;
  report += `- **文件修改**：${formatNumber(stats.filesModified)} 个\n`;
  report += `- **Git 提交**：${formatNumber(stats.gitCommits)} 次\n\n`;

  // 技术栈分析
  if (Object.keys(stats.languages).length > 0) {
    report += `## 💻 技术栈分析\n\n`;
    const totalLangUses = Object.values(stats.languages).reduce((a, b) => a + b, 0);
    const sortedLangs = Object.entries(stats.languages)
      .sort((a, b) => b[1] - a[1]);

    report += `| 编程语言 | 使用次数 | 占比 |\n`;
    report += `|---------|---------|------|\n`;
    for (const [lang, count] of sortedLangs) {
      report += `| ${lang} | ${count} | ${formatPercent(count, totalLangUses)} |\n`;
    }
    report += `\n`;
  }

  // 常用工具
  if (Object.keys(stats.toolCounts).length > 0) {
    report += `## 🛠️ 常用工具\n\n`;
    const sortedTools = Object.entries(stats.toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    report += `| 工具 | 调用次数 |\n`;
    report += `|------|----------|\n`;
    for (const [tool, count] of sortedTools) {
      report += `| ${tool} | ${formatNumber(count)} |\n`;
    }
    report += `\n`;
  }

  // 活跃项目
  if (Object.keys(stats.projects).length > 0) {
    report += `## 📁 活跃项目\n\n`;
    const sortedProjects = Object.entries(stats.projects)
      .sort((a, b) => b[1] - a[1]);

    report += `| 项目 | 会话数 |\n`;
    report += `|------|--------|\n`;
    for (const [project, count] of sortedProjects) {
      report += `| ${project} | ${count} |\n`;
    }
    report += `\n`;
  }

  // 会话类型分布
  if (Object.keys(stats.sessionTypes).length > 0) {
    report += `## 📋 会话类型分布\n\n`;
    const totalSessions = Object.values(stats.sessionTypes).reduce((a, b) => a + b, 0);
    const sortedTypes = Object.entries(stats.sessionTypes)
      .sort((a, b) => b[1] - a[1]);

    report += `| 类型 | 次数 | 占比 |\n`;
    report += `|------|------|------|\n`;
    for (const [type, count] of sortedTypes) {
      report += `| ${type} | ${count} | ${formatPercent(count, totalSessions)} |\n`;
    }
    report += `\n`;
  }

  // 时间范围
  report += `## 📅 时间范围\n\n`;
  if (stats.earliestSession && stats.latestSession) {
    report += `- **最早会话**：${stats.earliestSession.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
    report += `- **最近会话**：${stats.latestSession.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
  } else {
    report += `无会话数据\n`;
  }

  return report;
}

/**
 * 生成英文报告
 */
function generateEnglishReport(stats, range) {
  const avgDuration = stats.sessionCount > 0 ? stats.totalDuration / stats.sessionCount : 0;

  let report = `# Claude Code Insights Report - ${RANGE_NAMES_EN[range]}\n\n`;
  report += `> Generated at: ${new Date().toISOString()}\n\n`;

  // Session Overview
  report += `## 📊 Session Overview\n\n`;
  report += `- **Session Count**: ${stats.sessionCount}\n`;
  report += `- **Total Duration**: ${Math.round(stats.totalDuration)} minutes\n`;
  report += `- **Average Duration**: ${Math.round(avgDuration)} minutes\n`;
  report += `- **Token Usage**: Input ${formatNumber(stats.inputTokens)} / Output ${formatNumber(stats.outputTokens)}\n\n`;

  // Goal Analysis
  if (Object.keys(stats.goalCategories).length > 0) {
    report += `## 🎯 Goal Analysis\n\n`;
    const totalGoals = Object.values(stats.goalCategories).reduce((a, b) => a + b, 0);
    const sortedGoals = Object.entries(stats.goalCategories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    report += `| Category | Count | Percentage |\n`;
    report += `|----------|-------|------------|\n`;
    for (const [category, count] of sortedGoals) {
      report += `| ${category} | ${count} | ${formatPercent(count, totalGoals)} |\n`;
    }
    report += `\n`;
  }

  // Outcomes
  if (Object.keys(stats.outcomes).length > 0) {
    report += `### Outcomes\n\n`;
    const totalOutcomes = Object.values(stats.outcomes).reduce((a, b) => a + b, 0);
    const sortedOutcomes = Object.entries(stats.outcomes)
      .sort((a, b) => b[1] - a[1]);

    report += `| Outcome | Count | Percentage |\n`;
    report += `|---------|-------|------------|\n`;
    for (const [outcome, count] of sortedOutcomes) {
      report += `| ${outcome} | ${count} | ${formatPercent(count, totalOutcomes)} |\n`;
    }
    report += `\n`;
  }

  // Output Statistics
  report += `## 📈 Output Statistics\n\n`;
  report += `- **Lines Added**: ${formatNumber(stats.linesAdded)}\n`;
  report += `- **Lines Removed**: ${formatNumber(stats.linesRemoved)}\n`;
  report += `- **Files Modified**: ${formatNumber(stats.filesModified)}\n`;
  report += `- **Git Commits**: ${formatNumber(stats.gitCommits)}\n\n`;

  // Technology Stack
  if (Object.keys(stats.languages).length > 0) {
    report += `## 💻 Technology Stack\n\n`;
    const totalLangUses = Object.values(stats.languages).reduce((a, b) => a + b, 0);
    const sortedLangs = Object.entries(stats.languages)
      .sort((a, b) => b[1] - a[1]);

    report += `| Language | Uses | Percentage |\n`;
    report += `|----------|------|------------|\n`;
    for (const [lang, count] of sortedLangs) {
      report += `| ${lang} | ${count} | ${formatPercent(count, totalLangUses)} |\n`;
    }
    report += `\n`;
  }

  // Popular Tools
  if (Object.keys(stats.toolCounts).length > 0) {
    report += `## 🛠️ Popular Tools\n\n`;
    const sortedTools = Object.entries(stats.toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    report += `| Tool | Calls |\n`;
    report += `|------|-------|\n`;
    for (const [tool, count] of sortedTools) {
      report += `| ${tool} | ${formatNumber(count)} |\n`;
    }
    report += `\n`;
  }

  // Active Projects
  if (Object.keys(stats.projects).length > 0) {
    report += `## 📁 Active Projects\n\n`;
    const sortedProjects = Object.entries(stats.projects)
      .sort((a, b) => b[1] - a[1]);

    report += `| Project | Sessions |\n`;
    report += `|---------|----------|\n`;
    for (const [project, count] of sortedProjects) {
      report += `| ${project} | ${count} |\n`;
    }
    report += `\n`;
  }

  // Session Types
  if (Object.keys(stats.sessionTypes).length > 0) {
    report += `## 📋 Session Types\n\n`;
    const totalSessions = Object.values(stats.sessionTypes).reduce((a, b) => a + b, 0);
    const sortedTypes = Object.entries(stats.sessionTypes)
      .sort((a, b) => b[1] - a[1]);

    report += `| Type | Count | Percentage |\n`;
    report += `|------|-------|------------|\n`;
    for (const [type, count] of sortedTypes) {
      report += `| ${type} | ${count} | ${formatPercent(count, totalSessions)} |\n`;
    }
    report += `\n`;
  }

  // Time Range
  report += `## 📅 Time Range\n\n`;
  if (stats.earliestSession && stats.latestSession) {
    report += `- **Earliest Session**: ${stats.earliestSession.toISOString()}\n`;
    report += `- **Latest Session**: ${stats.latestSession.toISOString()}\n`;
  } else {
    report += `No session data\n`;
  }

  return report;
}

/**
 * 主函数
 */
function main() {
  // Windows 控制台 UTF-8 支持
  if (platform() === 'win32') {
    spawnSync('chcp', ['65001'], { shell: true, windowsHide: true });
  }

  // 解析参数
  const args = process.argv.slice(2);
  const range = args[0] || '1d';

  if (!TIME_RANGES[range]) {
    console.error(`错误：无效的时间范围参数。请使用: 1d, 7d, 30d, all`);
    process.exit(1);
  }

  console.log(`\n🔍 开始分析 ${RANGE_NAMES_ZH[range]} 的会话数据...\n`);

  // 读取数据
  const usageDataDir = path.join(os.homedir(), '.claude', 'usage-data');
  const sessionMetaDir = path.join(usageDataDir, 'session-meta');
  const facetsDir = path.join(usageDataDir, 'facets');

  console.log(`📂 数据目录: ${usageDataDir}`);

  const sessionMetas = readAllJsonFiles(sessionMetaDir);
  const facets = readAllJsonFiles(facetsDir);

  console.log(`✅ 读取了 ${sessionMetas.length} 个会话元数据`);
  console.log(`✅ 读取了 ${facets.length} 个会话分析数据\n`);

  // 合并数据
  const allSessions = mergeSessions(sessionMetas, facets);

  // 按时间范围过滤
  const filteredSessions = filterByTimeRange(allSessions, TIME_RANGES[range]);
  console.log(`🔍 过滤后剩余 ${filteredSessions.length} 个会话\n`);

  if (filteredSessions.length === 0) {
    console.log(`⚠️  没有找到 ${RANGE_NAMES_ZH[range]} 的会话数据`);
    process.exit(0);
  }

  // 计算统计数据
  const stats = calculateStats(filteredSessions);

  // 生成报告
  const chineseReport = generateChineseReport(stats, range);
  const englishReport = generateEnglishReport(stats, range);

  // 生成文件名
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');

  const timestamp = `${year}-${month}${day}-${hour}`;
  const baseFilename = `${timestamp}-${range}`;

  // 输出目录
  const outputDir = path.join(process.cwd(), '03_DWS', 'insights');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 保存文件
  const chineseFilePath = path.join(outputDir, `${baseFilename}-洞察报告.md`);
  const englishFilePath = path.join(outputDir, `${baseFilename}-insights-en.md`);

  fs.writeFileSync(chineseFilePath, chineseReport, 'utf-8');
  fs.writeFileSync(englishFilePath, englishReport, 'utf-8');

  console.log(`✅ 中文报告已生成: ${chineseFilePath}`);
  console.log(`✅ 英文报告已生成: ${englishFilePath}\n`);

  console.log(`📊 报告摘要:`);
  console.log(`   - 会话数: ${stats.sessionCount}`);
  console.log(`   - 总时长: ${formatDuration(stats.totalDuration)}`);
  console.log(`   - Token: ${formatNumber(stats.inputTokens + stats.outputTokens)}`);
  console.log(`   - 代码行: +${formatNumber(stats.linesAdded)} / -${formatNumber(stats.linesRemoved)}\n`);
}

// 运行主函数
main();
