#!/usr/bin/env bun

/**
 * Claude Code 环境配置脚本
 *
 * 功能：
 *   1. 创建/合并 .claude/settings.local.json（权限预审批）
 *   2. 安装项目级插件（commit-commands, feature-dev 等）
 *   3. 检测向量系统（阿里云百炼）
 *   4. 配置全局设置（--global）
 *   5. 配置 MCP 服务器（--mcp）
 *   6. 检测环境状态（--check）
 *
 * 使用：
 *   bun run setup:claude                # 默认：settings.local + 插件 + 向量系统检测
 *   bun run setup:claude --global       # 额外配置全局设置 + 全局插件
 *   bun run setup:claude --mcp          # 额外配置 MCP 服务器
 *   bun run setup:claude --all          # 全部配置
 *   bun run setup:claude --check        # 仅检测状态
 *   bun run setup:claude --skip-plugins # 跳过插件安装（Claude 会话内使用）
 */

import 'dotenv/config';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// 颜色
const c = {
  g: (t) => `\x1b[32m${t}\x1b[0m`,
  r: (t) => `\x1b[31m${t}\x1b[0m`,
  y: (t) => `\x1b[33m${t}\x1b[0m`,
  cy: (t) => `\x1b[36m${t}\x1b[0m`,
  b: (t) => `\x1b[1m${t}\x1b[0m`,
  d: (t) => `\x1b[90m${t}\x1b[0m`,
};

// 参数
const args = process.argv.slice(2);
const doGlobal = args.includes('--global') || args.includes('--all');
const doMcp = args.includes('--mcp') || args.includes('--all');
const checkOnly = args.includes('--check');
const skipPlugins = args.includes('--skip-plugins');

// 项目级插件列表
// 轻量化默认：不自动安装项目插件，需要时设置 KMS_INSTALL_DEFAULT_PLUGINS=1。
const DEFAULT_PROJECT_PLUGINS = [
  'commit-commands',
  'feature-dev',
  'code-review',
  'plugin-dev',
  'claude-md-management',
];
const PROJECT_PLUGINS = process.env.KMS_INSTALL_DEFAULT_PLUGINS === '1'
  ? DEFAULT_PROJECT_PLUGINS
  : [];

// 全局插件列表
// 轻量化默认：不自动安装全局插件，需要时设置 KMS_INSTALL_DEFAULT_PLUGINS=1。
const DEFAULT_GLOBAL_PLUGINS = [
  'context7',
  'ralph-loop',
  'code-simplifier',
];
const GLOBAL_PLUGINS = process.env.KMS_INSTALL_DEFAULT_PLUGINS === '1'
  ? DEFAULT_GLOBAL_PLUGINS
  : [];

// ============================================
// 工具函数
// ============================================

function printHeader(text) {
  console.log(c.b(`\n${text}`));
  console.log('═'.repeat(50));
}

function printSuccess(text) {
  console.log(c.g(`  ✅ ${text}`));
}

function printWarning(text) {
  console.log(c.y(`  ⚠️  ${text}`));
}

function printError(text) {
  console.log(c.r(`  ❌ ${text}`));
}

function printInfo(text) {
  console.log(c.cy(`  ℹ️  ${text}`));
}

function isClaudeAvailable() {
  const result = spawnSync('claude', ['--version'], {
    encoding: 'utf-8',
    timeout: 5000,
    windowsHide: true,
  });
  return result.status === 0;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJsonSafe(filePath, data) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function askQuestion(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ============================================
// Step 1: settings.local.json
// ============================================

function setupSettingsLocal() {
  printHeader('🔐 Step 1: 配置权限预审批');

  const targetPath = join(rootDir, '.claude', 'settings.local.json');
  const templatePath = join(rootDir, 'settings.local.template.json');

  if (!existsSync(templatePath)) {
    printError('模板文件不存在: settings.local.template.json');
    printInfo('请确保项目根目录包含 settings.local.template.json');
    return false;
  }

  const template = readJsonSafe(templatePath);
  if (!template) {
    printError('模板文件解析失败');
    return false;
  }

  if (!existsSync(targetPath)) {
    // 直接从模板复制
    writeJsonSafe(targetPath, template);
    printSuccess(`已创建 .claude/settings.local.json（${template.permissions.allow.length} 条权限）`);
    return true;
  }

  // 已存在：合并 allow 列表
  const current = readJsonSafe(targetPath);
  if (!current) {
    printWarning('现有文件解析失败，使用模板覆盖');
    writeJsonSafe(targetPath, template);
    printSuccess('已覆盖 settings.local.json');
    return true;
  }

  const currentAllow = new Set(current.permissions?.allow || []);
  const templateAllow = template.permissions?.allow || [];
  const newEntries = templateAllow.filter((entry) => !currentAllow.has(entry));

  if (newEntries.length === 0) {
    printSuccess(`settings.local.json 已存在且包含所有模板权限（${currentAllow.size} 条）`);
  } else {
    // 合并新权限
    const merged = {
      ...current,
      permissions: {
        ...current.permissions,
        allow: [...(current.permissions?.allow || []), ...newEntries],
      },
    };
    // 确保 enableAllProjectMcpServers 存在
    if (template.enableAllProjectMcpServers !== undefined) {
      merged.enableAllProjectMcpServers = template.enableAllProjectMcpServers;
    }
    writeJsonSafe(targetPath, merged);
    printSuccess(`已合并 ${newEntries.length} 条新权限（总计 ${merged.permissions.allow.length} 条）`);
    newEntries.forEach((e) => console.log(c.d(`    + ${e}`)));
  }

  return true;
}

// ============================================
// Step 2: 安装项目级插件
// ============================================

function installProjectPlugins() {
  printHeader('🔌 Step 2: 安装项目级插件');

  if (skipPlugins) {
    printInfo('跳过插件安装（--skip-plugins）');
    printInfo('请在新终端运行: bun run setup:claude');
    return true;
  }

  if (process.env.CLAUDE_SESSION_ID) {
    printWarning('检测到当前在 Claude 会话内');
    printInfo('插件安装需要在会话外的终端运行');
    printInfo('请打开新终端执行: bun run setup:claude');
    return true;
  }

  if (!isClaudeAvailable()) {
    printWarning('Claude Code CLI 未安装');
    printInfo('安装命令: npm install -g @anthropic-ai/claude-code');
    printInfo('安装后重新运行: bun run setup:claude');
    return true;
  }

  let installed = 0;
  let skipped = 0;

  for (const plugin of PROJECT_PLUGINS) {
    const result = spawnSync('claude', ['plugin', 'install', plugin, '--scope', 'project'], {
      cwd: rootDir,
      encoding: 'utf-8',
      timeout: 30000,
    });

    if (result.status === 0) {
      installed++;
      printSuccess(`${plugin}`);
    } else {
      const stderr = result.stderr || '';
      if (stderr.includes('already installed') || stderr.includes('already enabled')) {
        skipped++;
        printInfo(`${plugin}（已安装）`);
      } else {
        printWarning(`${plugin} 安装失败: ${stderr.slice(0, 100)}`);
      }
    }
  }

  console.log(c.d(`\n  安装: ${installed}, 已有: ${skipped}, 总计: ${PROJECT_PLUGINS.length}`));
  return true;
}

// ============================================
// Step 3: 检测向量系统（阿里云百炼 + SQLite）
// ============================================

function setupVecSystem() {
  printHeader('🧠 Step 3: 检测向量系统（阿里云百炼 + SQLite）');

  // 检查 DASHSCOPE_API_KEY
  if (process.env.DASHSCOPE_API_KEY) {
    printSuccess('DASHSCOPE_API_KEY 已配置');
  } else {
    printWarning('DASHSCOPE_API_KEY 未设置');
    printInfo('请在 .env 文件中配置 DASHSCOPE_API_KEY（阿里云百炼 API 密钥）');
  }

  // 检查 vectors.db
  const dbPath = join(rootDir, '.memory', 'vectors.db');
  if (existsSync(dbPath)) {
    printSuccess('vectors.db 已存在');
  } else {
    printWarning('vectors.db 不存在（向量索引未建立）');
    printInfo('建立索引: bun run memory:index');
  }

  // 检查 vec-*.js 工具
  const vecTools = ['vec-search.js', 'vec-index.js', 'vec-watch.js'];
  for (const tool of vecTools) {
    const toolPath = join(rootDir, 'tools', tool);
    if (existsSync(toolPath)) {
      printSuccess(`${tool} 存在`);
    } else {
      printError(`${tool} 缺失`);
    }
  }

  return true;
}

// ============================================
// Step 4: 全局设置（--global）
// ============================================

function setupGlobalSettings() {
  printHeader('🌐 Step 4: 配置全局设置');

  // 设置 Git 全局配置以解决中文文件路径八进制乱码问题
  try {
    spawnSync('git', ['config', '--global', 'core.quotepath', 'false']);
    printSuccess('Git 全局设置: core.quotepath = false（修复中文路径乱码）');
  } catch (e) {
    printWarning(`Git 全局配置 core.quotepath 设置失败: ${e.message}`);
  }

  const globalSettingsPath = join(homedir(), '.claude', 'settings.json');
  const existing = readJsonSafe(globalSettingsPath) || {};

  // 合并设置
  const merged = {
    ...existing,
    language: existing.language || 'Chinese',
    defaultMode: existing.defaultMode || 'plan',
  };

  writeJsonSafe(globalSettingsPath, merged);
  printSuccess(`全局设置已更新: ${globalSettingsPath}`);
  printInfo(`language: ${merged.language}, defaultMode: ${merged.defaultMode}`);

  // 安装全局插件
  if (!skipPlugins && !process.env.CLAUDE_SESSION_ID && isClaudeAvailable()) {
    for (const plugin of GLOBAL_PLUGINS) {
      const result = spawnSync('claude', ['plugin', 'install', plugin, '--scope', 'user'], {
        encoding: 'utf-8',
        timeout: 30000,
      });
      if (result.status === 0) {
        printSuccess(`全局插件: ${plugin}`);
      } else {
        printInfo(`全局插件: ${plugin}（跳过或已安装）`);
      }
    }
  }

  return true;
}

// ============================================
// Step 5: MCP 服务器配置（--mcp）
// ============================================

async function setupMcpServers() {
  printHeader('🔗 Step 5: 配置 MCP 服务器');

  const mcpPath = join(rootDir, '.mcp.json');

  if (existsSync(mcpPath)) {
    printSuccess('.mcp.json 已存在');
    printInfo('如需重新配置，请删除 .mcp.json 后重新运行');
    return true;
  }

  const apiKeyRaw = await askQuestion(c.cy('\n  请输入智谱 AI API Key（直接回车跳过）: '));
  const apiKey = apiKeyRaw.trim();

  if (!apiKey) {
    printInfo('跳过 MCP 服务器配置');
    return true;
  }

  if (apiKey.length < 10) {
    printError('API Key 过短（最少 10 字符），请检查输入');
    return false;
  }

  const mcpConfig = {
    mcpServers: {
      'web-reader': {
        type: 'http',
        url: `https://open.bigmodel.cn/api/mcp/mcp_service/call/${apiKey}`,
      },
      'web-search-prime': {
        type: 'http',
        url: `https://open.bigmodel.cn/api/mcp/web_search_pro/call/${apiKey}`,
      },
      zread: {
        type: 'http',
        url: `https://open.bigmodel.cn/api/mcp/zread/call/${apiKey}`,
      },
    },
  };

  writeJsonSafe(mcpPath, mcpConfig);
  printSuccess('MCP 服务器配置完成（3 个服务）');
  return true;
}

// ============================================
// 检测模式（--check）
// ============================================

function runCheck() {
  printHeader('🔍 Claude Code 环境状态检测');

  let allGood = true;

  // 1. settings.local.json
  const localPath = join(rootDir, '.claude', 'settings.local.json');
  if (existsSync(localPath)) {
    const data = readJsonSafe(localPath);
    const count = data?.permissions?.allow?.length || 0;
    printSuccess(`settings.local.json（${count} 条权限）`);
  } else {
    printError('settings.local.json 缺失');
    allGood = false;
  }

  // 2. settings.json（hooks + plugins）
  const settingsPath = join(rootDir, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    const data = readJsonSafe(settingsPath);
    const hookCount = Object.keys(data?.hooks || {}).length;
    const pluginCount = Object.keys(data?.enabledPlugins || {}).length;
    printSuccess(`settings.json（${hookCount} 个 hook 事件, ${pluginCount} 个插件声明）`);
  } else {
    printError('settings.json 缺失');
    allGood = false;
  }

  // 3. DashScope API + vectors.db
  if (process.env.DASHSCOPE_API_KEY) {
    printSuccess('DASHSCOPE_API_KEY（已配置）');
  } else {
    printError('DASHSCOPE_API_KEY 未设置（请在 .env 中配置）');
    allGood = false;
  }

  const dbPath = join(rootDir, '.memory', 'vectors.db');
  if (existsSync(dbPath)) {
    printSuccess('vectors.db（已建立索引）');
  } else {
    printWarning('vectors.db 不存在（运行 bun run memory:index 建立）');
    allGood = false;
  }

  // 4. Skills 目录
  const skillsDir = join(rootDir, '.claude', 'skills');
  if (existsSync(skillsDir)) {
    const dirs = readdirSync(skillsDir).filter((d) => {
      const fullPath = join(skillsDir, d);
      return statSync(fullPath).isDirectory() && existsSync(join(fullPath, 'SKILL.md'));
    });
    if (dirs.length > 0) {
      printSuccess(`Skills 目录（${dirs.length} 个 skill: ${dirs.join(', ')}）`);
    } else {
      printWarning('Skills 目录存在但未找到 SKILL.md 文件');
      allGood = false;
    }
  } else {
    printWarning('Skills 目录不存在');
    allGood = false;
  }

  // 5. 全局设置
  const globalPath = join(homedir(), '.claude', 'settings.json');
  if (existsSync(globalPath)) {
    const data = readJsonSafe(globalPath);
    printSuccess(`全局设置（language: ${data?.language || 'N/A'}）`);
  } else {
    printInfo('全局设置未配置（可选，运行 --global 配置）');
  }

  // 6. MCP 服务器
  const mcpPath = join(rootDir, '.mcp.json');
  if (existsSync(mcpPath)) {
    const data = readJsonSafe(mcpPath);
    const serverCount = Object.keys(data?.mcpServers || {}).length;
    printSuccess(`.mcp.json（${serverCount} 个 MCP 服务器）`);
  } else {
    printInfo('MCP 服务器未配置（可选，运行 --mcp 配置）');
  }

  // 7. Claude Code CLI
  if (process.env.CLAUDE_SESSION_ID) {
    printSuccess('Claude Code CLI（当前会话内运行）');
  } else if (isClaudeAvailable()) {
    printSuccess('Claude Code CLI（已安装）');
  } else {
    printInfo('Claude Code CLI 未安装（可选）');
  }

  console.log('\n' + '═'.repeat(50));
  if (allGood) {
    console.log(c.g('\n  ✅ Claude Code 环境配置完整\n'));
  } else {
    console.log(c.y('\n  ⚠️  部分配置缺失，运行 bun run setup:claude 修复\n'));
  }
}

// ============================================
// 主流程
// ============================================

async function main() {
  console.log(c.b('\n🤖 Claude Code 环境配置'));
  console.log('═'.repeat(50));

  if (checkOnly) {
    runCheck();
    return;
  }

  // Step 1: settings.local.json（始终执行）
  setupSettingsLocal();

  // Step 2: 项目级插件
  installProjectPlugins();

  // Step 3: 向量系统（阿里云百炼 + SQLite）
  setupVecSystem();

  // Step 4: 全局设置（--global / --all）
  if (doGlobal) {
    setupGlobalSettings();
  }

  // Step 5: MCP 服务器（--mcp / --all）
  if (doMcp) {
    await setupMcpServers();
  }

  // 打印总结
  printHeader('✅ 配置完成');
  console.log(c.d('\n  运行状态检测: bun run setup:claude --check'));
  if (!doGlobal) console.log(c.d('  配置全局设置: bun run setup:claude --global'));
  if (!doMcp) console.log(c.d('  配置 MCP 服务: bun run setup:claude --mcp'));
  console.log('');
}

main().catch((error) => {
  console.error(c.r(`\n配置失败: ${error.message}`));
  process.exit(1);
});
