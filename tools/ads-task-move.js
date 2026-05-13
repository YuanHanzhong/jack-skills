#!/usr/bin/env bun

/**
 * ADS 任务流转工具 (ADS Task Flow)
 *
 * 功能：
 * - 用于 ADS 需求三态流转时移动文件（收集 → 进行中 → 已完成）
 * - 显示源文件和目标路径
 * - Claude 自行判断移动（无需用户确认）
 * - 支持规划文件组自动同步移动
 * - 移动后自动更新 INDEX.md
 */

import { existsSync, renameSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename, relative, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

// 配置
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const ADS_DIR = join(PROJECT_ROOT, '04_ADS');

// ADS 三态目录
const STATES = {
  '1': join(ADS_DIR, '1_收集'),
  '2': join(ADS_DIR, '2_进行中'),
  '3': join(ADS_DIR, '3_已完成'),
  '收集': join(ADS_DIR, '1_收集'),
  '进行中': join(ADS_DIR, '2_进行中'),
  '已完成': join(ADS_DIR, '3_已完成'),
  'todo': join(ADS_DIR, '1_收集'),
  'doing': join(ADS_DIR, '2_进行中'),
  'done': join(ADS_DIR, '3_已完成')
};

// 规划文件类型
const PLANNING_TYPES = ['task_plan', 'findings', 'progress'];

// 模式标识
const MODE_TYPES = ['plan', 'exec', 'learn'];

// 命名正则（新格式：含 mode 前缀）
const NEW_PLANNING_PATTERN = /^(\d{2}-\d{4}-\d{2})-(plan|exec|learn)-(task_plan|findings|progress)-(.+)\.md$/;
// 命名正则（旧格式：不含 mode 前缀）
const OLD_PLANNING_PATTERN = /^(\d{2}-\d{4}-\d{2})-(task_plan|findings|progress)-(.+)\.md$/;

/**
 * 检查文件是否是规划文件（兼容新旧格式）
 */
function isPlanningFile(fileName) {
  return NEW_PLANNING_PATTERN.test(fileName) || OLD_PLANNING_PATTERN.test(fileName);
}

/**
 * 提取规划文件组的前缀（用于查找同组文件）
 *
 * 新格式: "26-0214-16-plan-task_plan-用户认证.md" -> "26-0214-16-plan-用户认证"
 * 旧格式: "26-0212-14-task_plan-优化规划模式.md" -> "26-0212-14-优化规划模式"
 */
function getPlanningGroupPrefix(fileName) {
  // 先尝试新格式
  const newMatch = fileName.match(NEW_PLANNING_PATTERN);
  if (newMatch) {
    return `${newMatch[1]}-${newMatch[2]}-${newMatch[4]}`;
  }

  // 再尝试旧格式
  const oldMatch = fileName.match(OLD_PLANNING_PATTERN);
  if (oldMatch) {
    return `${oldMatch[1]}-${oldMatch[3]}`;
  }

  return null;
}

/**
 * 查找同组的所有规划文件（兼容新旧格式）
 */
function findPlanningGroupFiles(sourcePath) {
  const fileName = basename(sourcePath);
  const sourceDir = dirname(sourcePath);

  // 尝试新格式
  const newMatch = fileName.match(NEW_PLANNING_PATTERN);
  if (newMatch) {
    const [, timestamp, mode, , taskName] = newMatch;
    const groupFiles = [];
    for (const type of PLANNING_TYPES) {
      const groupFileName = `${timestamp}-${mode}-${type}-${taskName}.md`;
      const groupFilePath = join(sourceDir, groupFileName);
      if (existsSync(groupFilePath)) {
        groupFiles.push(groupFilePath);
      }
    }
    return groupFiles.length > 0 ? groupFiles : [sourcePath];
  }

  // 尝试旧格式
  const oldMatch = fileName.match(OLD_PLANNING_PATTERN);
  if (oldMatch) {
    const [, timestamp, , taskName] = oldMatch;
    const groupFiles = [];
    for (const type of PLANNING_TYPES) {
      const groupFileName = `${timestamp}-${type}-${taskName}.md`;
      const groupFilePath = join(sourceDir, groupFileName);
      if (existsSync(groupFilePath)) {
        groupFiles.push(groupFilePath);
      }
    }
    return groupFiles.length > 0 ? groupFiles : [sourcePath];
  }

  return [sourcePath];
}

/**
 * 规范化状态名称
 */
function normalizeState(state) {
  if (state in STATES) {
    return STATES[state];
  }

  // 尝试匹配目录名
  const lowerState = state.toLowerCase();
  for (const [key, path] of Object.entries(STATES)) {
    if (key.toLowerCase() === lowerState) {
      return path;
    }
  }

  return null;
}

/**
 * 获取文件当前所在状态
 */
function getCurrentState(filePath) {
  const fullPath = join(PROJECT_ROOT, filePath);

  for (const [key, stateDir] of Object.entries(STATES)) {
    if (fullPath.startsWith(stateDir + '\\') || fullPath.startsWith(stateDir + '/')) {
      return { key, dir: stateDir };
    }
  }

  return null;
}

/**
 * 显示文件移动预览
 */
function showMovePreview(source, target) {
  const sourceRel = relative(PROJECT_ROOT, source);
  const targetRel = relative(PROJECT_ROOT, target);

  console.log('\n📦 文件移动预览');
  console.log('━'.repeat(60));
  console.log(`\n📄 源文件: ${sourceRel}`);
  console.log(`📁 目标位置: ${targetRel}`);
  console.log('\n' + '━'.repeat(60));
}

/**
 * 从用户获取确认
 */
async function getUserConfirmation() {
  console.log('\n是否确认移动文件？ (y/n): ');

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // 非 TTY 环境（如管道、Claude Code 内部调用），无法交互，拒绝操作
      resolve(false);
      return;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (key) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);

      if (key === 'y' || key === 'Y') {
        console.log('✅ 确认\n');
        resolve(true);
      } else if (key === '\u0003') {
        // Ctrl+C
        console.log('\n❌ 取消\n');
        process.exit(0);
      } else {
        console.log('❌ 取消\n');
        resolve(false);
      }
    };

    process.stdin.on('data', onData);
  });
}

/**
 * 移动文件
 */
function moveFile(source, target) {
  try {
    // 路径越界防护：源文件必须在 04_ADS/ 目录内
    const resolvedSourcePath = resolvePath(source);
    if (!resolvedSourcePath.startsWith(ADS_DIR + '/') && !resolvedSourcePath.startsWith(ADS_DIR + '\\')) {
      console.error('❌ 路径越界：只能移动 04_ADS/ 目录内的文件');
      process.exit(1);
    }

    // 确保目标目录存在
    const targetDir = dirname(target);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // 移动文件
    renameSync(source, target);
    return true;
  } catch (error) {
    console.error('❌ 移动文件失败:', error.message);
    return false;
  }
}

/**
 * 提取规划文件组信息（兼容新旧格式）
 * 返回: { prefix, taskName, type, mode?, isPlanningGroup }
 */
function extractPlanningGroupInfo(fileName) {
  // 新格式
  const newMatch = fileName.match(NEW_PLANNING_PATTERN);
  if (newMatch) {
    return {
      prefix: newMatch[1],
      mode: newMatch[2],
      type: newMatch[3],
      taskName: newMatch[4],
      isPlanningGroup: true
    };
  }

  // 旧格式
  const oldMatch = fileName.match(OLD_PLANNING_PATTERN);
  if (oldMatch) {
    return {
      prefix: oldMatch[1],
      type: oldMatch[2],
      taskName: oldMatch[3],
      isPlanningGroup: true
    };
  }

  return { isPlanningGroup: false };
}

/**
 * 更新 ADS INDEX.md
 */
function updateAdsIndex() {
  try {
    const indexPath = join(ADS_DIR, 'INDEX.md');

    // 收集各状态的文件
    const sections = {
      '1_收集': [],
      '2_进行中': [],
      '3_已完成': []
    };

    for (const state of Object.keys(sections)) {
      const stateDir = join(ADS_DIR, state);
      if (!existsSync(stateDir)) continue;

      const files = readdirSync(stateDir);

      // 用于跟踪已处理的规划文件组
      const processedGroups = new Set();

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const filePath = join(stateDir, file);
        const stats = statSync(filePath);
        const content = readFileSync(filePath, 'utf-8');

        // 提取标题
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : file.replace('.md', '');

        // 提取优先级和复杂度（如果有）
        const priorityMatch = content.match(/优先级[：:]\s*(\S+)/);
        const complexityMatch = content.match(/复杂度[：:]\s*(\S+)/);

        // 检查是否是规划文件组的一部分
        const planningInfo = extractPlanningGroupInfo(file);

        if (planningInfo.isPlanningGroup) {
          const groupKey = planningInfo.mode
            ? `${planningInfo.prefix}-${planningInfo.mode}-${planningInfo.taskName}`
            : `${planningInfo.prefix}-${planningInfo.taskName}`;

          // 只处理 task_plan 文件作为代表
          if (planningInfo.type === 'task_plan' && !processedGroups.has(groupKey)) {
            processedGroups.add(groupKey);

            // 检查同组的其他文件是否存在（兼容新旧格式）
            let groupFiles = [];
            for (const type of PLANNING_TYPES) {
              // 新格式
              const newGroupFile = planningInfo.mode
                ? `${planningInfo.prefix}-${planningInfo.mode}-${type}-${planningInfo.taskName}.md`
                : `${planningInfo.prefix}-${type}-${planningInfo.taskName}.md`;
              if (files.includes(newGroupFile)) {
                groupFiles.push(type);
              }
            }

            sections[state].push({
              file,
              title: `📋 ${planningInfo.taskName}`,
              priority: priorityMatch ? priorityMatch[1] : '-',
              complexity: complexityMatch ? complexityMatch[1] : '-',
              modified: stats.mtime,
              isPlanningGroup: true,
              groupFiles,
              taskName: planningInfo.taskName
            });
          }
        } else {
          // 普通文件
          sections[state].push({
            file,
            title,
            priority: priorityMatch ? priorityMatch[1] : '-',
            complexity: complexityMatch ? complexityMatch[1] : '-',
            modified: stats.mtime,
            isPlanningGroup: false
          });
        }
      }

      // 按修改时间倒序排序
      sections[state].sort((a, b) => b.modified - a.modified);
    }

    // 生成 INDEX.md
    let index = `# ADS 看板\n\n`;
    index += `> 应用数据层 - 问题驱动的实践\n\n`;

    // 统计规划任务组数量
    const planningCount1 = sections['1_收集'].filter(i => i.isPlanningGroup).length;
    const planningCount2 = sections['2_进行中'].filter(i => i.isPlanningGroup).length;
    const planningCount3 = sections['3_已完成'].filter(i => i.isPlanningGroup).length;

    index += `**统计**: `;
    index += `待处理 ${sections['1_收集'].length} (含 ${planningCount1} 个规划任务) | `;
    index += `进行中 ${sections['2_进行中'].length} (含 ${planningCount2} 个规划任务) | `;
    index += `已完成 ${sections['3_已完成'].length} (含 ${planningCount3} 个规划任务)\n\n`;
    index += `---\n\n`;

    // 1_收集
    index += `## 📥 1_收集 (${sections['1_收集'].length})\n\n`;
    if (sections['1_收集'].length > 0) {
      index += `| 问题/任务 | 优先级 | 复杂度 | 文件 |\n`;
      index += `|-----------|--------|--------|------|\n`;
      for (const item of sections['1_收集']) {
        if (item.isPlanningGroup) {
          const fileIcons = item.groupFiles.map(f => {
            if (f === 'task_plan') return '📋';
            if (f === 'findings') return '🔍';
            if (f === 'progress') return '📊';
            return '📄';
          }).join('');
          index += `| ${item.title} | ${item.priority} | ${item.complexity} | ${fileIcons} [📄](1_收集/${item.file}) |\n`;
        } else {
          index += `| ${item.title} | ${item.priority} | ${item.complexity} | [📄](1_收集/${item.file}) |\n`;
        }
      }
    } else {
      index += `暂无待处理问题\n`;
    }
    index += `\n`;

    // 2_进行中
    index += `## 🚧 2_进行中 (${sections['2_进行中'].length})\n\n`;
    if (sections['2_进行中'].length > 0) {
      index += `| 问题/任务 | 优先级 | 复杂度 | 文件 |\n`;
      index += `|-----------|--------|--------|------|\n`;
      for (const item of sections['2_进行中']) {
        if (item.isPlanningGroup) {
          const fileIcons = item.groupFiles.map(f => {
            if (f === 'task_plan') return '📋';
            if (f === 'findings') return '🔍';
            if (f === 'progress') return '📊';
            return '📄';
          }).join('');
          index += `| ${item.title} | ${item.priority} | ${item.complexity} | ${fileIcons} [📄](2_进行中/${item.file}) |\n`;
        } else {
          index += `| ${item.title} | ${item.priority} | ${item.complexity} | [📄](2_进行中/${item.file}) |\n`;
        }
      }
    } else {
      index += `暂无进行中的问题\n`;
    }
    index += `\n`;

    // 3_已完成
    index += `## ✅ 3_已完成 (${sections['3_已完成'].length})\n\n`;
    if (sections['3_已完成'].length > 0) {
      index += `| 问题/任务 | 优先级 | 复杂度 | 文件 |\n`;
      index += `|-----------|--------|--------|------|\n`;
      for (const item of sections['3_已完成']) {
        if (item.isPlanningGroup) {
          const fileIcons = item.groupFiles.map(f => {
            if (f === 'task_plan') return '📋';
            if (f === 'findings') return '🔍';
            if (f === 'progress') return '📊';
            return '📄';
          }).join('');
          index += `| ${item.title} | ${item.priority} | ${item.complexity} | ${fileIcons} [📄](3_已完成/${item.file}) |\n`;
        } else {
          index += `| ${item.title} | ${item.priority} | ${item.complexity} | [📄](3_已完成/${item.file}) |\n`;
        }
      }
    } else {
      index += `暂无已完成的问题\n`;
    }
    index += `\n`;

    index += `---\n\n`;
    index += `*自动生成于 ${new Date().toISOString().replace('T', ' ').slice(0, 19)}*\n`;

    writeFileSync(indexPath, index, 'utf-8');
    console.log('✅ 已更新 INDEX.md');
  } catch (error) {
    console.error('❌ 更新索引失败:', error.message);
  }
}

/**
 * 显示规划文件组移动预览
 */
function showPlanningGroupPreview(files, targetDir) {
  console.log('\n📦 规划文件组移动预览');
  console.log('━'.repeat(60));
  console.log('\n📁 以下规划文件将作为一个整体移动:\n');

  for (const file of files) {
    const fileName = basename(file);
    const targetPath = join(targetDir, fileName);
    console.log(`  📄 ${relative(PROJECT_ROOT, file)}`);
    console.log(`     → ${relative(PROJECT_ROOT, targetPath)}`);
  }

  console.log('\n' + '━'.repeat(60));
}

/**
 * 移动文件（ADS 三态流转）
 */
async function moveWithConfirm(filePath, targetState, options = {}) {
  // 标准化文件路径
  const sourcePath = join(PROJECT_ROOT, filePath);

  // 检查源文件是否存在
  if (!existsSync(sourcePath)) {
    console.error(`❌ 文件不存在: ${filePath}`);
    return false;
  }

  // 标准化目标状态
  const targetDir = normalizeState(targetState);
  if (!targetDir) {
    console.error(`❌ 无效的目标状态: ${targetState}`);
    console.error('   支持的状态: 1, 2, 3, 收集, 进行中, 已完成, todo, doing, done');
    return false;
  }

  const fileName = basename(sourcePath);

  // 检查是否是规划文件
  const isPlanning = isPlanningFile(fileName);
  let filesToMove = [sourcePath];

  if (isPlanning && !options.single) {
    // 查找同组的所有规划文件
    filesToMove = findPlanningGroupFiles(sourcePath);

    if (filesToMove.length > 1) {
      // 显示规划文件组预览
      showPlanningGroupPreview(filesToMove, targetDir);
    } else {
      // 单个规划文件，普通预览
      const targetPath = join(targetDir, fileName);
      showMovePreview(sourcePath, targetPath);
    }
  } else {
    // 普通文件
    const targetPath = join(targetDir, fileName);

    // 检查目标文件是否已存在
    if (existsSync(targetPath) && !options.force) {
      console.error(`❌ 目标文件已存在: ${relative(PROJECT_ROOT, targetPath)}`);
      console.error('   使用 --force 强制覆盖');
      return false;
    }

    showMovePreview(sourcePath, targetPath);
  }

  // 获取确认（除非使用 --yes）
  // 注：按照项目规则，Claude 应使用 --yes 参数自行判断移动
  if (!options.yes) {
    const confirmed = await getUserConfirmation();
    if (!confirmed) {
      return false;
    }
  }

  // 移动所有文件
  let success = 0;
  for (const file of filesToMove) {
    const targetFileName = basename(file);
    const targetPath = join(targetDir, targetFileName);

    if (moveFile(file, targetPath)) {
      console.log(`  ✅ 已移动: ${relative(PROJECT_ROOT, file)}`);
      console.log(`       → ${relative(PROJECT_ROOT, targetPath)}`);
      success++;
    } else {
      console.log(`  ❌ 移动失败: ${relative(PROJECT_ROOT, file)}`);
      console.log(`       → 目标路径: ${relative(PROJECT_ROOT, targetPath)}`);
    }
  }

  if (success === filesToMove.length) {
    console.log(`\n✅ 成功移动 ${success} 个文件`);
  } else {
    console.log(`\n⚠️ 部分成功: ${success}/${filesToMove.length} 个文件已移动`);
  }

  // 更新索引（除非使用 --no-index）
  if (!options.noIndex) {
    updateAdsIndex();
  }

  return success > 0;
}

/**
 * 批量移动文件
 */
async function moveMultiple(files, targetState, options = {}) {
  console.log(`\n准备移动 ${files.length} 个文件到: ${targetState}\n`);

  const processedGroups = new Set(); // 追踪已处理的规划文件组，避免重复处理
  let success = 0;
  let failed = 0;

  for (const file of files) {
    // 检查是否是规划文件，且所属组已被处理
    const fileName = basename(file);
    const groupPrefix = getPlanningGroupPrefix(fileName);
    if (groupPrefix && processedGroups.has(groupPrefix)) {
      // 同组文件已随第一次调用一起移动，跳过，计为成功
      success++;
      continue;
    }

    const result = await moveWithConfirm(file, targetState, { ...options, noIndex: true });
    if (result) {
      success++;
      if (groupPrefix) processedGroups.add(groupPrefix); // 记录已处理的组前缀
    } else {
      failed++;
    }
  }

  // 最后统一更新索引
  if (!options.noIndex) {
    updateAdsIndex();
  }

  console.log(`\n📊 移动完成: ✅ ${success} 成功, ❌ ${failed} 失败\n`);
}

/**
 * 主函数
 */
async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      yes: { type: 'boolean', short: 'y' },
      force: { type: 'boolean', short: 'f' },
      single: { type: 'boolean' },
      'no-index': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help || positionals.length === 0) {
    console.log(`
ADS 任务流转工具 (ADS Task Flow)

用法:
  bun run move <文件路径> <目标状态> [选项]
  bun run move <文件1> <文件2> ... <目标状态> [选项]

目标状态:
  1, 收集, todo       -> 1_收集
  2, 进行中, doing    -> 2_进行中
  3, 已完成, done     -> 3_已完成

选项:
  -y, --yes           跳过确认（默认行为，保留向后兼容）
  -f, --force         强制覆盖已存在的文件
  --single            单独移动规划文件（不移动同组文件）
  --no-index          不更新 INDEX.md
  -h, --help          显示帮助信息

规划文件组:
  命名格式为规划文件的文件会自动识别并作为一组移动：
  - 新格式: YY-MMDD-HH-<mode>-<类型>-<任务名>.md（mode: plan/exec/learn）
  - 旧格式: YY-MMDD-HH-<类型>-<任务名>.md（兼容）
  - 类型: task_plan / findings / progress

示例:
  bun run move 04_ADS/1_收集/问题.md 2
  bun run move 04_ADS/2_进行中/问题.md done
  bun run move 04_ADS/1_收集/26-0214-16-plan-task_plan-用户认证.md 2  # 新格式，同时移动同组文件
  bun run move 04_ADS/1_收集/26-0212-14-task_plan-优化规划.md 2       # 旧格式，同时移动同组文件
    `);
    return;
  }

  // 解析参数
  if (positionals.length < 2) {
    console.error('❌ 参数不足，请指定文件路径和目标状态');
    console.error('   使用 --help 查看帮助');
    process.exit(1);
  }

  const targetState = positionals[positionals.length - 1];
  const files = positionals.slice(0, -1);

  // 移动文件
  if (files.length === 1) {
    await moveWithConfirm(files[0], targetState, values);
  } else {
    await moveMultiple(files, targetState, values);
  }
}

// 运行主函数
main().catch(console.error);
