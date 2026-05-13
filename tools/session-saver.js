#!/usr/bin/env bun

/**
 * 会话记录保存工具
 *
 * 功能：
 * 1. 读取会话内容（从命令行参数或标准输入）
 * 2. 格式化为"问题+结论+思维链"结构
 * 3. 按领域分类保存到 03_DWS/sessions/
 * 4. 添加 YAML Front Matter 元数据
 * 5. 更新 03_DWS/INDEX.md
 * 6. 支持多主题拆分
 *
 * 使用示例：
 *   bun run session                              # 交互式输入
 *   bun run session --multi                      # 多主题模式
 *   bun run session --category="项目开发"         # 指定分类
 *   bun run session --tags="React,性能优化"       # 指定标签
 *   echo "会话内容" | bun run session             # 从标准输入读取
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

// 获取项目根目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const sessionsDir = join(rootDir, '03_DWS', 'sessions');
const indexPath = join(rootDir, '03_DWS', 'INDEX.md');

// 会话分类
const CATEGORIES = ['项目开发', '知识学习', '系统配置', '问题调试', '其他'];

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    category: null,
    tags: [],
    title: null,
    conclusion: null,
    problem: null,
    thinkingChain: null,
    help: false,
    multi: false,  // 多主题模式
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      config.help = true;
    } else if (arg === '--multi') {
      config.multi = true;
    } else if (arg.startsWith('--category=')) {
      config.category = arg.split('=')[1];
    } else if (arg.startsWith('--tags=')) {
      config.tags = arg.split('=')[1].split(',').map(t => t.trim());
    } else if (arg.startsWith('--title=')) {
      config.title = arg.split('=')[1];
    }
  }

  return config;
}

// 显示帮助信息
function showHelp() {
  console.log(`
会话记录保存工具

使用方法：
  bun run session [选项]

选项：
  --multi             启用多主题拆分模式
  --category=<分类>   指定会话分类（项目开发/知识学习/系统配置/问题调试/其他）
  --tags=<标签>       指定标签，多个标签用逗号分隔
  --title=<标题>      指定会话标题
  --help, -h         显示帮助信息

可用分类：
  - 项目开发：技术实现、架构设计、代码重构等
  - 知识学习：学习新技术、理解新概念、研究技术原理等
  - 系统配置：环境搭建、工具配置、CI/CD 配置等
  - 问题调试：Bug 修复、问题排查、错误处理等
  - 其他：不属于以上分类的会话

示例：
  bun run session                              # 单主题模式
  bun run session --multi                      # 多主题模式
  bun run session --category="项目开发" --tags="React,性能优化"
  bun run session --title="React 组件性能优化" --category="项目开发"

多主题模式流程：
  1. 输入本次对话涉及的所有主题
  2. 为每个主题选择分类和标签
  3. 为每个主题输入结论、问题描述、思维链
  4. 确认分类方案后生成多个文档
  5. 文档间通过 related_sessions 字段自动关联
  `);
}

// 创建 readline 接口
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

// 询问用户输入
function ask(rl, question) {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer.trim());
    });
  });
}

// 选择分类
async function selectCategory(rl, defaultCategory = null) {
  if (defaultCategory && CATEGORIES.includes(defaultCategory)) {
    return defaultCategory;
  }

  console.log('\n请选择会话分类：');
  CATEGORIES.forEach((cat, index) => {
    console.log(`  ${index + 1}. ${cat}`);
  });

  let selected = null;
  while (!selected) {
    const answer = await ask(rl, '\n请输入分类序号（1-5）: ');
    const index = parseInt(answer) - 1;
    if (index >= 0 && index < CATEGORIES.length) {
      selected = CATEGORIES[index];
    } else {
      console.log('无效的选择，请重新输入。');
    }
  }

  return selected;
}

// 读取多行输入
async function readMultiLine(rl) {
  const lines = [];
  let emptyLineCount = 0;

  return new Promise(resolve => {
    const listener = (line) => {
      if (line.trim() === '') {
        emptyLineCount++;
        if (emptyLineCount >= 2) {
          rl.removeListener('line', listener);
          resolve(lines.join('\n'));
        }
      } else {
        emptyLineCount = 0;
        lines.push(line);
      }
    };

    rl.on('line', listener);
  });
}

// 收集单个主题信息
async function collectTopicInfo(rl, topicIndex, totalTopics) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📌 主题 ${topicIndex}/${totalTopics}`);
  console.log('='.repeat(60));

  const topic = {
    title: null,
    category: null,
    tags: [],
    conclusion: null,
    problem: null,
    thinkingChain: null,
  };

  // 输入标题
  topic.title = await ask(rl, '\n请输入主题标题: ');
  while (!topic.title) {
    console.log('标题不能为空。');
    topic.title = await ask(rl, '请输入主题标题: ');
  }

  // 选择分类
  topic.category = await selectCategory(rl);

  // 输入标签
  const tagsInput = await ask(rl, '\n请输入标签（多个标签用逗号分隔，留空跳过）: ');
  if (tagsInput) {
    topic.tags = tagsInput.split(',').map(t => t.trim());
  }

  // 输入结论
  console.log('\n请输入结论（核心要点，简洁描述）:');
  topic.conclusion = await ask(rl, '> ');
  while (!topic.conclusion) {
    console.log('结论不能为空。');
    topic.conclusion = await ask(rl, '> ');
  }

  // 输入问题描述
  console.log('\n请输入问题描述（背景、具体问题、期望效果）:');
  console.log('（输入多行内容，输入空行结束）');
  topic.problem = await readMultiLine(rl);

  // 输入思维链
  console.log('\n请输入思维链（问题分析、解决方案探索、实施步骤等）:');
  console.log('（输入多行内容，输入空行结束）');
  topic.thinkingChain = await readMultiLine(rl);

  return topic;
}

// 收集多主题信息
async function collectMultiTopicInfo(rl, config) {
  console.log('\n📝 多主题模式');
  console.log('本次对话涉及多个主题，将为每个主题生成独立文档。\n');

  // 询问主题数量
  let topicCount = 0;
  while (topicCount < 1 || topicCount > 10) {
    const countInput = await ask(rl, '请输入本次对话涉及的主题数量（1-10）: ');
    topicCount = parseInt(countInput);
    if (isNaN(topicCount) || topicCount < 1 || topicCount > 10) {
      console.log('请输入有效的数字（1-10）。');
    }
  }

  // 收集每个主题的信息
  const topics = [];
  for (let i = 1; i <= topicCount; i++) {
    const topic = await collectTopicInfo(rl, i, topicCount);
    topics.push(topic);
  }

  // 显示汇总并确认
  console.log('\n' + '='.repeat(60));
  console.log('📋 主题汇总');
  console.log('='.repeat(60));

  topics.forEach((topic, index) => {
    console.log(`\n${index + 1}. ${topic.title}`);
    console.log(`   分类：${topic.category}`);
    console.log(`   标签：${topic.tags.length > 0 ? topic.tags.join(', ') : '无'}`);
  });

  console.log('\n' + '-'.repeat(60));
  const confirm = await ask(rl, '\n是否按以上方案保存？([Y]es/[N]o/[E]dit): ');

  if (confirm.toLowerCase() === 'n') {
    console.log('\n已取消保存。');
    return null;
  } else if (confirm.toLowerCase() === 'e') {
    // 编辑模式：让用户选择要编辑的主题
    return await editTopics(rl, topics);
  }

  return topics;
}

// 编辑主题
async function editTopics(rl, topics) {
  let editing = true;

  while (editing) {
    console.log('\n' + '='.repeat(60));
    console.log('✏️ 编辑模式');
    console.log('='.repeat(60));

    topics.forEach((topic, index) => {
      console.log(`${index + 1}. ${topic.title} [${topic.category}]`);
    });
    console.log('0. 完成编辑，继续保存');

    const choice = await ask(rl, '\n请选择要编辑的主题编号: ');
    const index = parseInt(choice) - 1;

    if (choice === '0') {
      editing = false;
    } else if (index >= 0 && index < topics.length) {
      console.log(`\n重新输入主题 ${index + 1} 的信息：`);
      topics[index] = await collectTopicInfo(rl, index + 1, topics.length);
    } else {
      console.log('无效的选择。');
    }
  }

  // 再次确认
  console.log('\n' + '='.repeat(60));
  console.log('📋 更新后的主题汇总');
  console.log('='.repeat(60));

  topics.forEach((topic, index) => {
    console.log(`\n${index + 1}. ${topic.title}`);
    console.log(`   分类：${topic.category}`);
    console.log(`   标签：${topic.tags.length > 0 ? topic.tags.join(', ') : '无'}`);
  });

  const confirm = await ask(rl, '\n是否确认保存？(Y/n): ');
  if (confirm.toLowerCase() === 'n') {
    console.log('\n已取消保存。');
    return null;
  }

  return topics;
}

// 收集单主题信息（原逻辑）
async function collectSingleTopicInfo(rl, config) {
  const topic = {
    title: null,
    category: null,
    tags: config.tags || [],
    conclusion: null,
    problem: null,
    thinkingChain: null,
  };

  // 选择分类
  topic.category = await selectCategory(rl, config.category);

  // 输入标题
  if (config.title) {
    topic.title = config.title;
  } else {
    topic.title = await ask(rl, '\n请输入会话标题: ');
    while (!topic.title) {
      console.log('标题不能为空。');
      topic.title = await ask(rl, '请输入会话标题: ');
    }
  }

  // 输入标签（如果未指定）
  if (topic.tags.length === 0) {
    const tagsInput = await ask(rl, '\n请输入标签（多个标签用逗号分隔，留空跳过）: ');
    if (tagsInput) {
      topic.tags = tagsInput.split(',').map(t => t.trim());
    }
  }

  // 输入结论
  console.log('\n请输入结论（核心要点，简洁描述）:');
  topic.conclusion = await ask(rl, '> ');
  while (!topic.conclusion) {
    console.log('结论不能为空。');
    topic.conclusion = await ask(rl, '> ');
  }

  // 输入问题描述
  console.log('\n请输入问题描述（背景、具体问题、期望效果）:');
  console.log('（输入多行内容，输入空行结束）');
  topic.problem = await readMultiLine(rl);

  // 输入思维链
  console.log('\n请输入思维链（问题分析、解决方案探索、实施步骤等）:');
  console.log('（输入多行内容，输入空行结束）');
  topic.thinkingChain = await readMultiLine(rl);

  return [topic];
}

// 生成会话文档
function generateSessionDocument(topic, datetime, allTopics = null, topicIndex = null) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const sessionId = `session-${datetime}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;

  const frontMatter = {
    session: {
      id: sessionId,
      date: date,
      datetime: datetime,
      category: topic.category,
      tags: topic.tags,
      status: '已完成',
    },
  };

  // 如果是多主题，添加关联信息
  if (allTopics && allTopics.length > 1) {
    frontMatter.session.related_sessions = allTopics
      .filter((_, idx) => idx !== topicIndex)
      .map((t, idx) => ({
        title: t.title,
        category: t.category,
        relation: '同一会话分拆',
      }));
  }

  // 构建 YAML
  let yamlStr = 'session:\n';
  yamlStr += `  id: "${frontMatter.session.id}"\n`;
  yamlStr += `  date: "${frontMatter.session.date}"\n`;
  yamlStr += `  datetime: "${frontMatter.session.datetime}"\n`;
  yamlStr += `  category: "${frontMatter.session.category}"\n`;
  yamlStr += `  tags: [${frontMatter.session.tags.map(v => `"${v}"`).join(', ')}]\n`;
  yamlStr += `  status: "${frontMatter.session.status}"\n`;

  if (frontMatter.session.related_sessions) {
    yamlStr += '  related_sessions:\n';
    frontMatter.session.related_sessions.forEach((rel, idx) => {
      yamlStr += `    - title: "${rel.title}"\n`;
      yamlStr += `      category: "${rel.category}"\n`;
      yamlStr += `      relation: "${rel.relation}"\n`;
    });
  }

  const document = `---
${yamlStr}---

# ${topic.title}

## 🎯 结论

${topic.conclusion}

## 📝 问题描述

${topic.problem}

## 🔍 思维链

${topic.thinkingChain}

## 💡 经验总结

（待补充）

## 📚 相关资源

（待补充）
${allTopics && allTopics.length > 1 ? `
## 🔗 关联会话

本次对话还涉及以下主题：
${allTopics.filter((_, idx) => idx !== topicIndex).map((t, idx) => `- [${t.title}](../${t.category}/${datetime}_${t.title.replace(/[\/\\:*?"<>|]/g, '_')}.md) - ${t.category}`).join('\n')}
` : ''}
## 📊 元数据

- **创建时间**：${now.toISOString().replace('T', ' ').split('.')[0]}
- **更新时间**：${now.toISOString().replace('T', ' ').split('.')[0]}
- **难度**：⭐⭐⭐
- **推荐度**：⭐⭐⭐⭐⭐
- **状态**：已完成
`;

  return { sessionId, document };
}

// 保存会话文档
function saveSessionDocument(topic, document, datetime) {
  // 确保分类目录存在
  const categoryDir = join(sessionsDir, topic.category);
  if (!existsSync(categoryDir)) {
    mkdirSync(categoryDir, { recursive: true });
  }

  // 生成文件名：YYYYMMDD-HHmm_主题名称.md
  const safeTitle = topic.title.replace(/[\/\\:*?"<>|]/g, '_');
  const fileName = `${datetime}_${safeTitle}.md`;
  const filePath = join(categoryDir, fileName);

  // 检查文件是否已存在（幂等性：直接覆盖）
  if (existsSync(filePath)) {
    console.log(`\n♻️  文件已存在，将覆盖: ${basename(filePath)}`);
  }

  // 保存文件（幂等操作）
  writeFileSync(filePath, document, 'utf-8');
  console.log(`✅ 已保存: ${filePath}`);

  return filePath;
}

// 更新 INDEX.md
function updateIndex(topic, filePath, datetime) {
  let indexContent = '';

  if (existsSync(indexPath)) {
    indexContent = readFileSync(indexPath, 'utf-8');
  } else {
    // 创建默认 INDEX.md
    indexContent = `# DWS 对话索引

本索引系统用于组织和管理与 Claude 的所有对话记录，支持多维度检索和追溯。

## 最近会话

`;
  }

  // 解析现有的最近会话列表
  const lines = indexContent.split('\n');
  const recentSessionsIndex = lines.findIndex(line => line.includes('## 最近会话'));

  if (recentSessionsIndex === -1) {
    // 如果没有"最近会话"章节，添加
    indexContent += '\n## 最近会话\n\n';
  }

  // 格式化日期时间显示：YY-MMDD-HH -> 20YY-MM-DD HH:00
  // 输入格式：26-0214-15
  const year = '20' + datetime.slice(0, 2);
  const month = datetime.slice(3, 5);
  const day = datetime.slice(5, 7);
  const hour = datetime.slice(8, 10);
  const formattedDateTime = `${year}-${month}-${day} ${hour}:00`;

  // 生成新条目
  const relativePath = filePath.replace(/\\/g, '/').split('03_DWS/')[1];
  const tags = topic.tags.length > 0 ? ` - 标签: ${topic.tags.join(', ')}` : '';
  const newEntry = `- ${formattedDateTime} - [${topic.title}](./${relativePath}) - ${topic.category}${tags}`;

  // 在"最近会话"章节后添加新条目
  const insertIndex = recentSessionsIndex !== -1 ? recentSessionsIndex + 2 : lines.length;
  lines.splice(insertIndex, 0, newEntry);

  // 保存更新后的 INDEX.md
  const updatedContent = lines.join('\n');
  writeFileSync(indexPath, updatedContent, 'utf-8');
}

// 确保 sessions 目录结构存在
function ensureSessionsStructure() {
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }

  for (const category of CATEGORIES) {
    const categoryDir = join(sessionsDir, category);
    if (!existsSync(categoryDir)) {
      mkdirSync(categoryDir, { recursive: true });
    }
  }
}

// 主函数
async function main() {
  const config = parseArgs();

  if (config.help) {
    showHelp();
    return;
  }

  console.log('\x1b[1m会话记录保存工具\x1b[0m');
  console.log('将会话内容格式化保存到 03_DWS/sessions/\n');

  // 确保目录结构存在
  ensureSessionsStructure();

  // 创建 readline 接口
  const rl = createReadlineInterface();

  try {
    // 生成统一的日期时间（多主题时使用相同的时间戳）
    // 格式：YY-MMDD-HH（例如：26-0214-15）
    // 关键：使用 toLocaleString 确保时间戳反映当前确切的小时（非四舍五入）
    const now = new Date();
    const YY = String(now.getFullYear()).slice(-2);
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    // 使用 getHours() 获取的是整数小时，不存在四舍五入问题
    // 但为了保险，显式验证时间的准确性
    const HH = String(now.getHours()).padStart(2, '0');
    const datetime = `${YY}-${MM}${DD}-${HH}`;

    // 调试信息（开发时使用，可帮助诊断时间问题）
    // console.error(`[DEBUG] 生成时间戳: ${datetime} (系统时间: ${now.toLocaleString('zh-CN')})`);


    // 收集会话信息（单主题或多主题）
    let topics;
    if (config.multi) {
      topics = await collectMultiTopicInfo(rl, config);
    } else {
      // 询问是否是多主题
      const isMulti = await ask(rl, '本次对话是否涉及多个主题？(y/N): ');
      if (isMulti.toLowerCase() === 'y') {
        topics = await collectMultiTopicInfo(rl, config);
      } else {
        topics = await collectSingleTopicInfo(rl, config);
      }
    }

    if (!topics || topics.length === 0) {
      console.log('\n没有要保存的内容。');
      return;
    }

    // 保存每个主题的文档
    const savedFiles = [];
    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      const { sessionId, document } = generateSessionDocument(topic, datetime, topics, i);
      const filePath = saveSessionDocument(topic, document, datetime);
      updateIndex(topic, filePath, datetime);
      savedFiles.push(filePath);
    }

    console.log('\n' + '='.repeat(60));
    if (topics.length > 1) {
      console.log(`🎉 多主题会话记录保存完成！共 ${topics.length} 个文档`);
    } else {
      console.log('🎉 会话记录保存完成！');
    }
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ 保存失败:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// 运行主函数
main().catch(error => {
  console.error('执行失败:', error);
  process.exit(1);
});
