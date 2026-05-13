#!/usr/bin/env bun

/**
 * daily-manager.js - 每日日志管理工具
 *
 * 命令：
 * - create:           创建今日日志（基于模板）
 * - suggest:          检测未完成任务并推荐目标（输出 JSON）
 * - set-goals:        设定今日目标
 * - update-status:    更新目标状态（✅/❌）
 * - update-insights:  更新今日收获
 * - stats:            统计今日数据（输出 JSON）
 * - report:           生成综合报告（更新日志文件）
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { execSync } from 'child_process';

// 配置
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const DAILY_DIR = join(PROJECT_ROOT, '00_DIM', 'daily');
const TEMPLATE_PATH = join(PROJECT_ROOT, '00_DIM', 'templates', '每日日志模板.md');
const ADS_DIR = join(PROJECT_ROOT, '04_ADS');
const DWS_DIR = join(PROJECT_ROOT, '03_DWS');

// 星期映射
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/**
 * 读取文件并规范化行尾符（Windows CRLF → LF）
 */
function readFileNormalized(filePath) {
  return readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
}

// ─── 日期工具 ───────────────────────────────────

function getToday() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return {
    yymmdd: `${yy}-${mm}${dd}`,              // 26-0214
    yymmddFull: `${now.getFullYear()}-${mm}-${dd}`, // 2026-02-14
    weekday: WEEKDAYS[now.getDay()],
    hhmm: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    yy, mm, dd
  };
}

function getYesterday() {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yy}-${mm}${dd}`;
}

function getDailyPath(dateStr) {
  return join(DAILY_DIR, `${dateStr}.md`);
}

// ─── create: 创建今日日志 ───────────────────────

function createDailyLog() {
  const today = getToday();
  const dailyPath = getDailyPath(today.yymmdd);

  if (existsSync(dailyPath)) {
    console.log(JSON.stringify({
      success: true,
      action: 'exists',
      message: '今日日志已存在',
      path: dailyPath
    }));
    return;
  }

  // 确保目录存在
  if (!existsSync(DAILY_DIR)) {
    mkdirSync(DAILY_DIR, { recursive: true });
  }

  // 读取模板
  let template;
  if (existsSync(TEMPLATE_PATH)) {
    template = readFileNormalized(TEMPLATE_PATH);
  } else {
    console.error(JSON.stringify({
      success: false,
      error: '模板文件不存在',
      path: TEMPLATE_PATH
    }));
    process.exit(1);
  }

  // 替换变量
  const content = template
    .replace(/\{\{YY-MMDD\}\}/g, today.yymmdd)
    .replace(/\{\{YY-MM-DD\}\}/g, today.yymmddFull)
    .replace(/\{\{星期X\}\}/g, today.weekday)
    .replace(/\{\{YY-MMDD-HH:MM\}\}/g, `${today.yymmdd}-${today.hhmm}`);

  writeFileSync(dailyPath, content, 'utf-8');

  console.log(JSON.stringify({
    success: true,
    action: 'created',
    message: `已创建今日日志: ${today.yymmdd}.md`,
    path: dailyPath
  }));
}

// ─── suggest: 推荐今日目标 ──────────────────────

function suggestGoals() {
  const result = {
    unfinishedYesterday: [],
    adsTasks: { inProgress: [], collected: [] },
    suggestions: { p0: [], p1: [], p2: [] }
  };

  // 1. 读取昨日未完成目标
  const yesterdayPath = getDailyPath(getYesterday());
  if (existsSync(yesterdayPath)) {
    const content = readFileNormalized(yesterdayPath);
    // 解析目标表格中状态为 ⏳ 或 ❌ 的项
    const tableRegex = /\|\s*(P[012])\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(⏳|❌)\s*\|/g;
    let match;
    let _safeCount = 0;
    while ((match = tableRegex.exec(content)) !== null) {
      if (++_safeCount > 1000) break; // 防正则灾难性回溯
      const [, priority, goal, link] = match;
      if (goal && !goal.includes('{{')) {
        result.unfinishedYesterday.push({ priority, goal: goal.trim(), link: link.trim() });
      }
    }
  }

  // 2. 读取 ADS 进行中任务
  const inProgressDir = join(ADS_DIR, '2_进行中');
  if (existsSync(inProgressDir)) {
    const files = readdirSync(inProgressDir).filter(f => f.endsWith('.md') && f !== 'README.md');
    for (const file of files) {
      const filePath = join(inProgressDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].replace(/[📋🔍📊📄]/g, '').trim() : file.replace('.md', '');

      // 提取优先级
      const priorityMatch = content.match(/优先级[：:]\s*(\S+)/);

      // 只取 task_plan 文件作为代表（避免 findings/progress 重复）
      if (file.includes('task_plan') || (!file.includes('findings') && !file.includes('progress'))) {
        result.adsTasks.inProgress.push({
          file,
          title,
          priority: priorityMatch ? priorityMatch[1] : '未标注',
          path: `04_ADS/2_进行中/${file}`
        });
      }
    }
  }

  // 3. 读取 ADS 收集箱任务
  const collectedDir = join(ADS_DIR, '1_收集');
  if (existsSync(collectedDir)) {
    const files = readdirSync(collectedDir).filter(f => f.endsWith('.md') && f !== 'README.md');
    for (const file of files) {
      const filePath = join(collectedDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].replace(/[📋🔍📊📄]/g, '').trim() : file.replace('.md', '');

      if (file.includes('task_plan') || (!file.includes('findings') && !file.includes('progress'))) {
        result.adsTasks.collected.push({
          file,
          title,
          path: `04_ADS/1_收集/${file}`
        });
      }
    }
  }

  // 4. 生成推荐（评分算法）
  const scored = [];

  // 昨日未完成 +10 分
  for (const task of result.unfinishedYesterday) {
    scored.push({
      source: '昨日未完成',
      goal: `继续昨日：${task.goal}`,
      link: task.link,
      score: 10
    });
  }

  // ADS 进行中 +8 分
  for (const task of result.adsTasks.inProgress) {
    scored.push({
      source: 'ADS 进行中',
      goal: task.title,
      link: `[${task.title}](../../${task.path})`,
      score: 8
    });
  }

  // ADS 收集箱 +5 分
  for (const task of result.adsTasks.collected) {
    scored.push({
      source: 'ADS 收集箱',
      goal: `启动新任务：${task.title}`,
      link: `[${task.title}](../../${task.path})`,
      score: 5
    });
  }

  // 按分数排序
  scored.sort((a, b) => b.score - a.score);

  // 分配优先级
  for (const item of scored) {
    if (item.score >= 10) {
      result.suggestions.p0.push(item);
    } else if (item.score >= 5) {
      result.suggestions.p1.push(item);
    } else {
      result.suggestions.p2.push(item);
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

// ─── set-goals: 设定今日目标 ────────────────────

function setGoals(options) {
  const today = getToday();
  const dailyPath = getDailyPath(today.yymmdd);

  if (!existsSync(dailyPath)) {
    console.error(JSON.stringify({ success: false, error: '今日日志不存在，请先运行 create' }));
    process.exit(1);
  }

  let content = readFileNormalized(dailyPath);

  // 构建新的目标表格
  const goals = [];
  if (options.p0) goals.push({ priority: 'P0', goal: options.p0, link: options.p0link || '无', status: '⏳' });
  if (options.p1) goals.push({ priority: 'P1', goal: options.p1, link: options.p1link || '无', status: '⏳' });
  if (options.p2) goals.push({ priority: 'P2', goal: options.p2, link: options.p2link || '无', status: '⏳' });

  if (goals.length === 0) {
    console.error(JSON.stringify({ success: false, error: '至少需要设定一个目标（--p0, --p1, --p2）' }));
    process.exit(1);
  }

  // 替换目标表格
  const tableHeader = '| 优先级 | 目标 | 关联任务 | 状态 |\n|-------|------|---------|------|\n';
  const tableRows = goals.map(g => `| ${g.priority} | ${g.goal} | ${g.link} | ${g.status} |`).join('\n');
  const newTable = tableHeader + tableRows + '\n';

  // 用正则替换整个目标表格
  const tableRegex = /\| 优先级 \| 目标 \| 关联任务 \| 状态 \|\n\|[-|]+\|\n((\|.+\|\n?)*)/;
  if (tableRegex.test(content)) {
    content = content.replace(tableRegex, newTable);
  }

  // 更新 updated 时间
  content = content.replace(/updated: ".*?"/, `updated: "${today.yymmdd}-${today.hhmm}"`);

  writeFileSync(dailyPath, content, 'utf-8');

  console.log(JSON.stringify({
    success: true,
    message: `已设定 ${goals.length} 个今日目标`,
    goals: goals.map(g => `${g.priority}: ${g.goal}`)
  }));
}

// ─── update-status: 更新目标状态 ────────────────

function updateStatus(options) {
  const today = getToday();
  const dailyPath = getDailyPath(today.yymmdd);

  if (!existsSync(dailyPath)) {
    console.error(JSON.stringify({ success: false, error: '今日日志不存在' }));
    process.exit(1);
  }

  let content = readFileNormalized(dailyPath);

  // 更新指定优先级的状态
  const statusMap = { done: '✅', skip: '❌', wip: '⏳' };

  for (const [key, newStatus] of Object.entries(options)) {
    const match = key.match(/^(p[012])status$/);
    if (!match) continue;

    const priority = match[1].toUpperCase();
    const symbol = statusMap[newStatus] || newStatus;

    // 替换对应行的状态
    const rowRegex = new RegExp(`(\\| ${priority} \\|.+\\|.+\\|)\\s*(⏳|✅|❌)\\s*\\|`);
    content = content.replace(rowRegex, `$1 ${symbol} |`);
  }

  // 更新 updated 时间
  content = content.replace(/updated: ".*?"/, `updated: "${today.yymmdd}-${today.hhmm}"`);

  writeFileSync(dailyPath, content, 'utf-8');

  console.log(JSON.stringify({ success: true, message: '目标状态已更新' }));
}

// ─── update-insights: 更新今日收获 ──────────────

function updateInsights(options) {
  const today = getToday();
  const dailyPath = getDailyPath(today.yymmdd);

  if (!existsSync(dailyPath)) {
    console.error(JSON.stringify({ success: false, error: '今日日志不存在' }));
    process.exit(1);
  }

  let content = readFileNormalized(dailyPath);

  // 构建收获内容
  const insights = [];
  if (options.insight1) insights.push(options.insight1);
  if (options.insight2) insights.push(options.insight2);
  if (options.insight3) insights.push(options.insight3);

  if (insights.length === 0) {
    console.error(JSON.stringify({ success: false, error: '至少需要 1 条收获（--insight1, --insight2, --insight3）' }));
    process.exit(1);
  }

  // 替换收获章节
  const insightLines = insights.map((insight, i) => {
    // 支持 "关键词:详细说明" 格式
    const colonIdx = insight.indexOf(':');
    if (colonIdx > 0 && colonIdx < 20) {
      const key = insight.slice(0, colonIdx).trim();
      const detail = insight.slice(colonIdx + 1).trim();
      return `${i + 1}. **${key}**：${detail}`;
    }
    return `${i + 1}. **${insight}**`;
  }).join('\n');

  // 替换收获区域
  const insightRegex = /## 💡 今日收获（3条核心洞察）\n\n[\s\S]*?(?=\n---)/;
  content = content.replace(insightRegex, `## 💡 今日收获（3条核心洞察）\n\n${insightLines}`);

  // 更新 updated 时间
  content = content.replace(/updated: ".*?"/, `updated: "${today.yymmdd}-${today.hhmm}"`);

  writeFileSync(dailyPath, content, 'utf-8');

  console.log(JSON.stringify({
    success: true,
    message: `已更新 ${insights.length} 条收获`,
    insights
  }));
}

// ─── stats: 统计今日数据 ────────────────────────

function calculateStats() {
  const today = getToday();
  const result = {
    date: today.yymmdd,
    sessions: 0,
    codeLines: { added: 0, deleted: 0 },
    documents: 0,
    flashcards: 0,
    goals: { total: 0, completed: 0, inProgress: 0, skipped: 0 }
  };

  // 1. 统计今日会话数（扫描 03_DWS/sessions/ 子目录）
  const sessionsDir = join(DWS_DIR, 'sessions');
  if (existsSync(sessionsDir)) {
    const categories = readdirSync(sessionsDir).filter(d => {
      const p = join(sessionsDir, d);
      return existsSync(p) && statSync(p).isDirectory();
    });

    for (const category of categories) {
      const catDir = join(sessionsDir, category);
      const files = readdirSync(catDir).filter(f =>
        f.startsWith(today.yymmdd) && f.endsWith('.md')
      );
      result.sessions += files.length;
    }
  }

  // 2. 统计今日代码行数
  try {
    const gitOutput = execSync('git diff --stat --since="1 day ago"', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 5000
    });
    const statLine = gitOutput.split('\n').pop()?.trim() || '';
    const addMatch = statLine.match(/(\d+) insertion/);
    const delMatch = statLine.match(/(\d+) deletion/);
    result.codeLines.added = addMatch ? parseInt(addMatch[1]) : 0;
    result.codeLines.deleted = delMatch ? parseInt(delMatch[1]) : 0;
  } catch {
    // git 命令失败时忽略
  }

  // 3. 统计今日新增文档
  if (existsSync(sessionsDir)) {
    const categories = readdirSync(sessionsDir).filter(d => {
      const p = join(sessionsDir, d);
      return existsSync(p) && statSync(p).isDirectory();
    });

    for (const category of categories) {
      const catDir = join(sessionsDir, category);
      const files = readdirSync(catDir).filter(f => {
        if (!f.endsWith('.md')) return false;
        const filePath = join(catDir, f);
        const stat = statSync(filePath);
        const created = new Date(stat.birthtime);
        const now = new Date();
        return created.toDateString() === now.toDateString();
      });
      result.documents += files.length;
    }
  }

  // 4. 读取今日日志中的目标完成情况
  const dailyPath = getDailyPath(today.yymmdd);
  if (existsSync(dailyPath)) {
    const content = readFileNormalized(dailyPath);
    const tableRegex = /\|\s*(P[012])\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(⏳|✅|❌)\s*\|/g;
    let match;
    let _safeCount2 = 0;
    while ((match = tableRegex.exec(content)) !== null) {
      if (++_safeCount2 > 1000) break; // 防正则灾难性回溯
      const [, , goal, , status] = match;
      if (goal && !goal.includes('{{')) {
        result.goals.total++;
        if (status === '✅') result.goals.completed++;
        else if (status === '⏳') result.goals.inProgress++;
        else if (status === '❌') result.goals.skipped++;
      }
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

// ─── report: 生成综合报告 ───────────────────────

function generateReport() {
  const today = getToday();
  const dailyPath = getDailyPath(today.yymmdd);

  if (!existsSync(dailyPath)) {
    console.error(JSON.stringify({ success: false, error: '今日日志不存在' }));
    process.exit(1);
  }

  let content = readFileNormalized(dailyPath);

  // 获取统计数据（内部调用，不输出）
  const stats = getStatsData();

  // 更新统计数据章节
  const completionRate = stats.goals.total > 0
    ? Math.round((stats.goals.completed / stats.goals.total) * 100)
    : 0;

  const statsSection = `## 📈 统计数据（自动填充）

- **目标完成率**：${stats.goals.completed}/${stats.goals.total}（${completionRate}%）
- **会话数量**：${stats.sessions} 次
- **代码行数**：+${stats.codeLines.added}/-${stats.codeLines.deleted}
- **沉淀文档**：${stats.documents} 篇`;

  const statsRegex = /## 📈 统计数据（自动填充）\n\n[\s\S]*$/;
  content = content.replace(statsRegex, statsSection);

  // 更新状态为已完成
  content = content.replace(/status: in_progress/, 'status: completed');
  content = content.replace(/updated: ".*?"/, `updated: "${today.yymmdd}-${today.hhmm}"`);

  writeFileSync(dailyPath, content, 'utf-8');

  console.log(JSON.stringify({
    success: true,
    message: '综合报告已生成',
    stats: {
      completionRate: `${completionRate}%`,
      sessions: stats.sessions,
      codeLines: stats.codeLines,
      documents: stats.documents
    }
  }));
}

/**
 * 内部使用的统计函数（不输出到 stdout）
 */
function getStatsData() {
  const today = getToday();
  const result = {
    sessions: 0,
    codeLines: { added: 0, deleted: 0 },
    documents: 0,
    goals: { total: 0, completed: 0, inProgress: 0, skipped: 0 }
  };

  const sessionsDir = join(DWS_DIR, 'sessions');
  if (existsSync(sessionsDir)) {
    const categories = readdirSync(sessionsDir).filter(d => {
      const p = join(sessionsDir, d);
      return existsSync(p) && statSync(p).isDirectory();
    });

    for (const category of categories) {
      const catDir = join(sessionsDir, category);
      const files = readdirSync(catDir).filter(f =>
        f.startsWith(today.yymmdd) && f.endsWith('.md')
      );
      result.sessions += files.length;
      result.documents += files.length;
    }
  }

  try {
    const gitOutput = execSync('git diff --stat --since="1 day ago"', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 5000
    });
    const statLine = gitOutput.split('\n').pop()?.trim() || '';
    const addMatch = statLine.match(/(\d+) insertion/);
    const delMatch = statLine.match(/(\d+) deletion/);
    result.codeLines.added = addMatch ? parseInt(addMatch[1]) : 0;
    result.codeLines.deleted = delMatch ? parseInt(delMatch[1]) : 0;
  } catch {
    // ignore
  }

  const dailyPath = getDailyPath(today.yymmdd);
  if (existsSync(dailyPath)) {
    const content = readFileNormalized(dailyPath);
    const tableRegex = /\|\s*(P[012])\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(⏳|✅|❌)\s*\|/g;
    let match;
    let _safeCount3 = 0;
    while ((match = tableRegex.exec(content)) !== null) {
      if (++_safeCount3 > 1000) break; // 防正则灾难性回溯
      const [, , goal, , status] = match;
      if (goal && !goal.includes('{{')) {
        result.goals.total++;
        if (status === '✅') result.goals.completed++;
        else if (status === '⏳') result.goals.inProgress++;
        else if (status === '❌') result.goals.skipped++;
      }
    }
  }

  return result;
}

// ─── CLI 主入口 ──────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
每日日志管理工具 (Daily Manager)

用法:
  bun run daily <命令> [选项]

命令:
  create              创建今日日志（基于模板）
  suggest             推荐今日目标（输出 JSON）
  set-goals           设定今日目标
  update-status       更新目标状态
  update-insights     更新今日收获
  stats               统计今日数据（输出 JSON）
  report              生成综合报告

set-goals 选项:
  --p0=<目标>         P0 核心目标（必做）
  --p1=<目标>         P1 重要目标（应做）
  --p2=<目标>         P2 可选目标（可做）
  --p0link=<链接>     P0 关联任务链接
  --p1link=<链接>     P1 关联任务链接
  --p2link=<链接>     P2 关联任务链接

update-status 选项:
  --p0status=<done|skip|wip>   P0 状态
  --p1status=<done|skip|wip>   P1 状态
  --p2status=<done|skip|wip>   P2 状态

update-insights 选项:
  --insight1=<收获>   第 1 条收获
  --insight2=<收获>   第 2 条收获
  --insight3=<收获>   第 3 条收获

示例:
  bun run daily create
  bun run daily suggest
  bun run daily set-goals --p0="实现日目标系统" --p1="学习 Boris 工作流"
  bun run daily update-status --p0status=done --p1status=wip
  bun run daily update-insights --insight1="轻量化设计的核心是最小必填" --insight2="推荐算法减少决策时间"
  bun run daily stats
  bun run daily report
    `);
    return;
  }

  // 解析剩余参数
  const restArgs = args.slice(1);
  const options = {};
  for (const arg of restArgs) {
    const eqIdx = arg.indexOf('=');
    if (arg.startsWith('--') && eqIdx > 0) {
      const key = arg.slice(2, eqIdx);
      const value = arg.slice(eqIdx + 1);
      options[key] = value;
    }
  }

  switch (command) {
    case 'create':
      createDailyLog();
      break;
    case 'suggest':
      suggestGoals();
      break;
    case 'set-goals':
      setGoals(options);
      break;
    case 'update-status':
      updateStatus(options);
      break;
    case 'update-insights':
      updateInsights(options);
      break;
    case 'stats':
      calculateStats();
      break;
    case 'report':
      generateReport();
      break;
    default:
      console.error(`❌ 未知命令: ${command}`);
      console.error('   使用 --help 查看帮助');
      process.exit(1);
  }
}

main();
