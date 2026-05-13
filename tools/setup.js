#!/usr/bin/env bun

/**
 * 一键设置脚本 - 初始化项目环境
 *
 * 执行内容：
 *   1. 安装 Node.js 依赖（bun install）
 *   2. 创建 .env 文件（从 .env.example 复制）
 *   3. 安装编辑器扩展（读取 .vscode/extensions.json）
 *   4. 检测外部依赖（调用 check-dependencies.js）
 *   5. Claude Code 环境设置（调用 setup-claude.js）
 *   6. 提供下一步操作指引
 *
 * 使用：
 *   bun run setup                  # 完整设置
 *   bun run setup --skip-deps      # 跳过依赖安装
 *   bun run setup --skip-check     # 跳过依赖检测
 *   bun run setup --skip-editor-extensions  # 跳过编辑器扩展安装
 */

import { spawnSync } from 'child_process';
import { existsSync, copyFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
const skipDeps = args.includes('--skip-deps');
const skipCheck = args.includes('--skip-check');
const skipEditorExtensions = args.includes('--skip-editor-extensions');

// ============================================
// 工具函数
// ============================================

function printHeader(text) {
  console.log(c.b(`\n${text}`));
  console.log('═'.repeat(50));
}

function printSuccess(text) {
  console.log(c.g(`✅ ${text}`));
}

function printWarning(text) {
  console.log(c.y(`⚠️  ${text}`));
}

function printError(text) {
  console.log(c.r(`❌ ${text}`));
}

function printInfo(text) {
  console.log(c.cy(`ℹ️  ${text}`));
}

// ============================================
// Step 1: 安装 Node.js 依赖
// ============================================

function installDependencies() {
  printHeader('📦 安装 Node.js 依赖');

  if (skipDeps) {
    printInfo('跳过依赖安装（--skip-deps）');
    return true;
  }

  console.log(c.d('正在运行 bun install...\n'));

  const result = spawnSync('bun', ['install'], {
    cwd: rootDir,
    stdio: 'inherit',
    encoding: 'utf-8',
  });

  if (result.status === 0) {
    printSuccess('依赖安装完成');
    return true;
  }

  printError('依赖安装失败');
  return false;
}

// ============================================
// Step 2: 创建 .env 文件
// ============================================

function setupEnvFile() {
  printHeader('📄 配置环境变量');

  const envPath = join(rootDir, '.env');
  const examplePath = join(rootDir, '.env.example');

  // 检查 .env.example 是否存在
  if (!existsSync(examplePath)) {
    printWarning('.env.example 不存在，跳过环境变量配置');
    return true;
  }

  // 如果 .env 已存在，检查是否需要更新
  if (existsSync(envPath)) {
    printSuccess('.env 文件已存在');

    // 检查是否有新增的变量
    const example = readFileSync(examplePath, 'utf-8');
    const current = readFileSync(envPath, 'utf-8');

    const exampleKeys = example
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => line.split('=')[0].trim());

    const currentKeys = current
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => line.split('=')[0].trim());

    const missingKeys = exampleKeys.filter((key) => !currentKeys.includes(key));

    if (missingKeys.length > 0) {
      printWarning(`发现 ${missingKeys.length} 个新的环境变量:`);
      missingKeys.forEach((key) => console.log(c.y(`   - ${key}`)));
      printInfo('请手动添加到 .env 文件中（参考 .env.example）');
    } else {
      printInfo('环境变量配置完整');
    }

    return true;
  }

  // 复制 .env.example 到 .env
  try {
    copyFileSync(examplePath, envPath);
    printSuccess('.env 文件已创建（从 .env.example 复制）');
    console.log(c.y('\n⚠️  请编辑 .env 文件并填写必要的配置:'));
    console.log(c.cy('   - OPENAI_API_KEY（智谱 AI 密钥，推荐）'));
    console.log(c.cy('   - OPENAI_BASE_URL（https://open.bigmodel.cn/api/paas/v4/）'));
    console.log(c.d('   或者选择其他 provider（Google/Voyage/本地）'));
    return true;
  } catch (error) {
    printError(`创建 .env 文件失败: ${error.message}`);
    return false;
  }
}

// ============================================
// Step 2.5: 安装 macOS 高效 CLI 工具
// ============================================

const MODERN_CLI_TOOLS = [
  { cmd: 'rg',      brew: 'ripgrep',   desc: '超快内容搜索（grep 替代）' },
  { cmd: 'fd',      brew: 'fd',        desc: '快速文件查找（find 替代）' },
  { cmd: 'bat',     brew: 'bat',       desc: '语法高亮文件查看（cat 替代）' },
  { cmd: 'eza',     brew: 'eza',       desc: '带颜色文件列表（ls 替代）' },
  { cmd: 'fzf',     brew: 'fzf',       desc: '模糊交互式搜索过滤器' },
  { cmd: 'delta',   brew: 'git-delta', desc: '语法高亮 git diff（diff 替代）' },
  { cmd: 'jq',      brew: 'jq',        desc: 'JSON 数据处理与格式化' },
  { cmd: 'btop',    brew: 'btop',      desc: '资源监控（top 替代）' },
  { cmd: 'tldr',    brew: 'tldr',      desc: '简化版命令帮助手册（man 替代）' },
  { cmd: 'dust',    brew: 'dust',      desc: '直观磁盘用量（du 替代）' },
  { cmd: 'zoxide',  brew: 'zoxide',    desc: '智能目录跳转（cd 替代）' },
];

function installModernCliTools() {
  printHeader('⚡ 安装高效 CLI 工具（macOS）');

  if (process.platform !== 'darwin') {
    printInfo('非 macOS 环境，跳过 CLI 工具安装');
    return true;
  }

  // 检查 brew 是否可用
  const brewCheck = spawnSync('which', ['brew'], { encoding: 'utf-8' });
  if (brewCheck.status !== 0) {
    printWarning('未检测到 Homebrew，跳过 CLI 工具安装');
    printInfo('安装 Homebrew: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
    return true;
  }

  const missing = MODERN_CLI_TOOLS.filter(({ cmd }) => {
    const r = spawnSync('which', [cmd], { encoding: 'utf-8' });
    return r.status !== 0;
  });

  if (missing.length === 0) {
    printSuccess('所有高效 CLI 工具已安装');
    return true;
  }

  console.log(c.d(`发现 ${missing.length} 个未安装的工具，正在安装...\n`));
  missing.forEach(({ cmd, desc }) => console.log(c.cy(`  - ${cmd}: ${desc}`)));
  console.log('');

  const brewPackages = missing.map(({ brew }) => brew);
  const result = spawnSync('brew', ['install', ...brewPackages], {
    stdio: 'inherit',
    encoding: 'utf-8',
  });

  if (result.status === 0) {
    printSuccess(`已安装: ${missing.map(({ cmd }) => cmd).join(', ')}`);
  } else {
    printWarning('部分工具安装失败，可手动运行: brew install ' + brewPackages.join(' '));
  }

  return true;
}

// ============================================
// Step 3: 安装编辑器扩展
// ============================================

function installEditorExtensions() {
  printHeader('🧩 安装编辑器扩展');

  if (skipEditorExtensions) {
    printInfo('跳过编辑器扩展安装（--skip-editor-extensions）');
    return true;
  }

  const result = spawnSync('bun', ['run', 'tools/install-vscode-extensions.js'], {
    cwd: rootDir,
    stdio: 'inherit',
    encoding: 'utf-8',
  });

  // 编辑器扩展安装失败不应阻断 setup 主流程
  if (result.status !== 0) {
    printWarning('编辑器扩展安装步骤未完成，可稍后手动运行: bun run setup:extensions');
  }

  return true;
}

// ============================================
// Step 4: 检测外部依赖
// ============================================

function checkDependencies() {
  printHeader('🔍 检测外部依赖');

  if (skipCheck) {
    printInfo('跳过依赖检测（--skip-check）');
    return { success: true, missingRequired: false };
  }

  console.log(c.d('正在检测系统依赖...\n'));

  const result = spawnSync('bun', ['run', 'tools/check-dependencies.js'], {
    cwd: rootDir,
    stdio: 'inherit',
    encoding: 'utf-8',
  });

  return {
    success: result.status === 0,
    missingRequired: result.status !== 0,
  };
}

// ============================================
// Step 5: Claude Code 环境设置
// ============================================

function setupClaudeCode() {
  printHeader('🤖 Claude Code 环境设置');

  const setupArgs = process.env.CLAUDE_SESSION_ID
    ? ['run', 'tools/setup-claude.js', '--skip-plugins']
    : ['run', 'tools/setup-claude.js'];

  const result = spawnSync('bun', setupArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    encoding: 'utf-8',
  });

  if (process.env.CLAUDE_SESSION_ID) {
    printInfo('插件安装请在新终端运行: bun run setup:claude');
  }

  return result.status === 0;
}

// ============================================
// Step 6: 提供下一步指引
// ============================================

function printNextSteps(depCheckResult) {
  printHeader('✅ 设置完成');

  console.log(c.b('\n📋 下一步操作:\n'));

  const envPath = join(rootDir, '.env');
  const envExists = existsSync(envPath);
  const envContent = envExists ? readFileSync(envPath, 'utf-8') : '';
  const needEnvEdit = envExists && (
    envContent.includes('your_zhipu_api_key_here') ||
    envContent.includes('your_api_key_here') ||
    !envContent.match(/^(OPENAI_API_KEY|ZHIPU_API_KEY)=\S+/m)
  );

  if (depCheckResult.missingRequired) {
    console.log(c.r('1. 安装缺少的必需依赖（见上方检测报告）'));
    console.log(c.d('   重新检测: bun run tools/check-dependencies.js'));
    console.log('');
  }

  if (needEnvEdit) {
    console.log(c.y('2. 编辑 .env 文件，填写 API 密钥:'));
    console.log(c.cy('   - OPENAI_API_KEY（智谱 AI 密钥）'));
    console.log(c.cy('   - OPENAI_BASE_URL（https://open.bigmodel.cn/api/paas/v4/）'));
    console.log(c.d('   注册地址: https://open.bigmodel.cn/'));
    console.log('');
  }

  if (!depCheckResult.missingRequired && !needEnvEdit) {
    console.log(c.g('环境已就绪，可以开始使用！\n'));
  }

  console.log(c.b('常用命令:\n'));
  console.log(c.cy('  bun run memory:init         # 初始化记忆系统'));
  console.log(c.cy('  bun run memory:search "..."  # 语义搜索'));
  console.log(c.cy('  bun run index               # 生成索引'));
  console.log(c.cy('  bun run check               # 检查命名规范'));

  console.log(c.b('\n详细文档:\n'));
  console.log(c.cy('  cat INSTALL.md              # 安装指南'));
  console.log(c.cy('  cat CLAUDE.md               # 项目规范'));

  console.log('');
}

// ============================================
// 主流程
// ============================================

async function main() {
  console.log(c.b('🚀 知识管理系统 - 一键设置'));
  console.log('═'.repeat(50));

  // Step 1: 安装依赖
  const depsOk = installDependencies();
  if (!depsOk) {
    printError('安装依赖失败，请检查错误信息');
    process.exit(1);
  }

  // Step 2: 设置 .env
  const envOk = setupEnvFile();
  if (!envOk) {
    printError('环境变量配置失败');
    process.exit(1);
  }

  // Step 2.5: 安装高效 CLI 工具（macOS）
  installModernCliTools();

  // Step 3: 安装编辑器扩展
  installEditorExtensions();

  // Step 4: 检测依赖
  const depCheck = checkDependencies();

  // Step 5: Claude Code 环境设置
  setupClaudeCode();

  // Step 6: 下一步指引
  printNextSteps(depCheck);

  // 退出码
  process.exit(depCheck.success ? 0 : 1);
}

main().catch((error) => {
  console.error(c.r(`\n设置失败: ${error.message}`));
  process.exit(1);
});
