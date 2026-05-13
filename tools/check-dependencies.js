#!/usr/bin/env bun

/**
 * 依赖检测工具 - 统一检查所有必需和可选依赖
 *
 * 检测项目：
 *   - Bun（必需）- JavaScript 运行时
 *   - Node.js（可选）- 兼容性参考
 *   - DASHSCOPE_API_KEY（可选）- 阿里云百炼 embedding API
 *   - WSL（Windows 必需）- Windows 下运行 Linux 工具
 *   - sentence-transformers（可选）- 备用本地 embedding provider
 *
 * 使用：
 *   bun run tools/check-dependencies.js           # 完整检测
 *   bun run tools/check-dependencies.js --json    # JSON 输出
 *   bun run tools/check-dependencies.js --silent  # 只返回退出码（0=全部必需依赖OK，1=缺少依赖）
 */

import { spawnSync } from 'child_process';
import { platform } from 'os';
import 'dotenv/config';

const isWindows = platform() === 'win32';
const isMac = platform() === 'darwin';
const isLinux = platform() === 'linux';

// 颜色
const c = {
  g: (t) => `\x1b[32m${t}\x1b[0m`,    // 绿色
  r: (t) => `\x1b[31m${t}\x1b[0m`,    // 红色
  y: (t) => `\x1b[33m${t}\x1b[0m`,    // 黄色
  cy: (t) => `\x1b[36m${t}\x1b[0m`,   // 青色
  b: (t) => `\x1b[1m${t}\x1b[0m`,     // 粗体
  d: (t) => `\x1b[90m${t}\x1b[0m`,    // 暗色
};

// 参数
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const silent = args.includes('--silent');

// ============================================
// 检测逻辑
// ============================================

/**
 * 执行命令并返回结果
 */
function checkCommand(cmd, args = [], options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf-8',
    timeout: 5000,
    windowsHide: true,
    ...options,
  });

  return {
    available: result.status === 0,
    version: result.stdout?.trim() || '',
    error: result.stderr?.trim() || '',
  };
}

/**
 * 获取安装命令
 */
function getInstallCommand(name) {
  const commands = {
    Bun: {
      linux: 'curl -fsSL https://bun.sh/install | bash',
      mac: 'curl -fsSL https://bun.sh/install | bash',
      windows: 'powershell -c "irm bun.sh/install.ps1 | iex"',
    },
    'Node.js': {
      linux: 'https://nodejs.org/en/download/package-manager',
      mac: 'brew install node',
      windows: 'https://nodejs.org/en/download',
    },
    'Homebrew (macOS)': {
      mac: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    },
    WSL: {
      windows: 'wsl --install',
    },
    'Claude Code': {
      linux: 'npm install -g @anthropic-ai/claude-code',
      mac: 'npm install -g @anthropic-ai/claude-code',
      windows: 'npm install -g @anthropic-ai/claude-code',
    },
    'sentence-transformers': {
      linux: 'pip3 install sentence-transformers',
      mac: 'pip3 install sentence-transformers',
      windows: 'pip3 install sentence-transformers',
    },
  };

  const cmd = commands[name];
  if (!cmd) return 'N/A';

  if (isWindows) return cmd.windows || cmd.linux || 'N/A';
  if (isMac) return cmd.mac || cmd.linux || 'N/A';
  return cmd.linux || 'N/A';
}

/**
 * 定义检测项
 */
const checks = [
  {
    name: 'Bun',
    required: true,
    check: () => checkCommand('bun', ['--version']),
    description: 'JavaScript 运行时（项目必需）',
  },
  {
    name: 'Node.js',
    required: false,
    check: () => checkCommand('node', ['--version']),
    description: 'JavaScript 运行时（兼容性参考）',
  },
  {
    name: 'DASHSCOPE_API_KEY',
    required: false,
    check: () => {
      const key = process.env.DASHSCOPE_API_KEY;
      if (key && key.length > 10) {
        return { available: true, version: `已配置 (${key.slice(0,4)}...${key.slice(-4)})` };
      }
      return { available: false, version: '', error: '未配置' };
    },
    description: '阿里云百炼 Embedding API 密钥（向量搜索需要）',
  },
  {
    name: 'WSL',
    required: isWindows,
    check: () => {
      if (!isWindows) return { available: true, version: 'N/A (not Windows)' };
      return checkCommand('wsl', ['--version']);
    },
    description: 'Windows Subsystem for Linux',
  },
  {
    name: 'Homebrew (macOS)',
    required: isMac,
    check: () => {
      if (!isMac) return { available: true, version: 'N/A (not macOS)' };
      return checkCommand('brew', ['--version']);
    },
    description: 'macOS 包管理器（安装依赖必需）',
  },
  {
    name: 'Claude Code',
    required: false,
    check: () => {
      if (process.env.CLAUDE_SESSION_ID) {
        return { available: true, version: '当前会话内运行' };
      }
      return checkCommand('claude', ['--version']);
    },
    description: 'Claude Code CLI（AI 助手）',
  },
  {
    name: 'sentence-transformers',
    required: false,
    check: () => {
      if (isWindows) {
        return checkCommand('wsl', ['python3', '-c', 'import sentence_transformers']);
      }
      return checkCommand('python3', ['-c', 'import sentence_transformers']);
    },
    description: '本地 embedding provider（可选）',
  },
];

// ============================================
// 执行检测
// ============================================

let results;
try {
  results = await Promise.race([
    Promise.all(checks.map(async (check) => {
      const result = await check.check();
      return {
        name: check.name,
        required: check.required,
        description: check.description,
        available: result.available,
        version: result.version,
        installCommand: getInstallCommand(check.name),
      };
    })),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('依赖检测超时（15s），请检查网络连接')), 15000)
    )
  ]);
} catch (err) {
  console.error(c.r(`\n❌ ${err.message}`));
  process.exit(1);
}

// ============================================
// 输出结果
// ============================================

if (jsonOutput) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

if (silent) {
  const missingRequired = results.some((r) => r.required && !r.available);
  process.exit(missingRequired ? 1 : 0);
}

// 美化输出
console.log(c.b('\n🔍 依赖检测报告\n'));
console.log('═'.repeat(70));

let hasErrors = false;

for (const result of results) {
  const icon = result.available ? '✅' : (result.required ? '❌' : '⚠️');
  const color = result.available ? c.g : (result.required ? c.r : c.y);
  const requiredTag = result.required ? c.b('[必需]') : c.d('[可选]');

  console.log(color(`\n${icon} ${result.name} ${requiredTag}`));
  console.log(c.d(`   ${result.description}`));

  if (result.available) {
    console.log(c.g(`   版本: ${result.version || 'OK'}`));
  } else {
    if (result.required) hasErrors = true;
    console.log(color(`   状态: 未安装`));
    console.log(c.cy(`   安装: ${result.installCommand}`));
  }
}

console.log('\n' + '═'.repeat(70));

// 总结
const requiredMissing = results.filter((r) => r.required && !r.available);
const optionalMissing = results.filter((r) => !r.required && !r.available);

if (requiredMissing.length === 0) {
  console.log(c.g('\n✅ 所有必需依赖已安装，可以正常使用'));
} else {
  console.log(c.r(`\n❌ 缺少 ${requiredMissing.length} 个必需依赖:`));
  requiredMissing.forEach((r) => {
    console.log(c.r(`   - ${r.name}`));
    console.log(c.cy(`     安装: ${r.installCommand}`));
  });
}

if (optionalMissing.length > 0) {
  console.log(c.y(`\n⚠️  缺少 ${optionalMissing.length} 个可选依赖（功能受限）:`));
  optionalMissing.forEach((r) => {
    console.log(c.y(`   - ${r.name}: ${r.description}`));
    console.log(c.cy(`     安装: ${r.installCommand}`));
  });
}

// 下一步建议
if (requiredMissing.length > 0) {
  console.log(c.b('\n📋 下一步:\n'));
  console.log('  1. 安装缺少的必需依赖（见上方安装命令）');
  console.log('  2. 重新运行检测: bun run tools/check-dependencies.js');
  console.log('  3. 运行 setup: bun run setup');
}

console.log('');

process.exit(hasErrors ? 1 : 0);
