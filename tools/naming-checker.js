#!/usr/bin/env bun

/**
 * naming-checker.js
 * 文件命名合规性批量检查工具
 *
 * 使用方法:
 *   bun run check                # 全量检查 DWS + ADS
 *   bun run check --layer=DWS    # 只检查 DWS
 *   bun run check --layer=ADS    # 只检查 ADS
 *   bun run check --verbose      # 显示所有文件（包括合规的）
 */

import { glob } from 'glob';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import {
  validateFileName,
  detectLayerFromPath,
  generateFixSuggestion,
} from './validators/naming-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    layer: null, // 'DWS' | 'ADS' | null (all)
    verbose: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--layer=')) {
      const layer = arg.split('=')[1].toUpperCase();
      if (['DWS', 'ADS'].includes(layer)) {
        options.layer = layer;
      } else {
        console.error(`${colors.red}❌ 无效的层级: ${layer}${colors.reset}`);
        console.error(`   支持的层级: DWS, ADS`);
        process.exit(1);
      }
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * 打印帮助信息
 */
function printHelp() {
  console.log(`
${colors.cyan}文件命名合规性检查工具${colors.reset}

${colors.yellow}使用方法:${colors.reset}
  bun run check                # 全量检查 DWS + ADS
  bun run check --layer=DWS    # 只检查 DWS 会话文件
  bun run check --layer=ADS    # 只检查 ADS 任务文件
  bun run check --verbose      # 显示所有文件（包括合规的）
  bun run check --help         # 显示帮助信息

${colors.yellow}检查范围:${colors.reset}
  - DWS 会话: 03_DWS/sessions/**/*.md
  - ADS 任务: 04_ADS/**/*.md

${colors.yellow}命名规范:${colors.reset}
  - DWS: YY-MMDD-HH-主题名称.md
  - ADS（新）: YY-MMDD-HH-(chat|learn|plan|exec|review)-(task_plan|findings|progress)-主题名称.md
  - ADS（旧，兼容）: YY-MMDD-HH-(task_plan|findings|progress)-主题名称.md
`);
}

/**
 * 扫描指定层级的文件
 */
async function scanFiles(layer) {
  const patterns = [];

  if (!layer || layer === 'DWS') {
    patterns.push(join(ROOT_DIR, '03_DWS', 'sessions', '**', '*.md'));
  }

  if (!layer || layer === 'ADS') {
    patterns.push(join(ROOT_DIR, '04_ADS', '**', '*.md'));
  }

  const files = [];

  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      ignore: ['**/node_modules/**'],
      windowsPathsNoEscape: true,
    });

    for (const filePath of matches) {
      files.push({
        path: filePath,
        name: basename(filePath),
      });
    }
  }

  return files;
}

/**
 * 打印检查报告
 */
function printReport(results, options) {
  const { valid, invalid } = results;
  const total = valid.length + invalid.length;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${colors.cyan}📋 文件命名合规性检查报告${colors.reset}`);
  console.log(`${'='.repeat(70)}\n`);

  // 统计信息
  console.log(`${colors.blue}📊 统计:${colors.reset}`);
  console.log(`   总计: ${total} 个文件`);
  console.log(`   ${colors.green}✅ 合规: ${valid.length} 个${colors.reset}`);
  console.log(`   ${colors.red}❌ 不合规: ${invalid.length} 个${colors.reset}`);

  if (total > 0) {
    const complianceRate = ((valid.length / total) * 100).toFixed(1);
    console.log(`   ${colors.cyan}📈 合规率: ${complianceRate}%${colors.reset}\n`);
  }

  // 显示合规文件（verbose 模式）
  if (options.verbose && valid.length > 0) {
    console.log(`${colors.green}✅ 合规文件:${colors.reset}`);
    const byLayer = { DWS: [], ADS: [] };
    for (const file of valid) {
      byLayer[file.layer].push(file);
    }

    for (const [layer, files] of Object.entries(byLayer)) {
      if (files.length > 0) {
        console.log(`\n   ${colors.cyan}${layer} 层 (${files.length} 个):${colors.reset}`);
        for (const file of files) {
          console.log(`   ${colors.gray}✓${colors.reset} ${file.name}`);
        }
      }
    }
    console.log();
  }

  // 显示不合规文件
  if (invalid.length > 0) {
    console.log(`${colors.red}❌ 不合规文件:${colors.reset}\n`);

    for (const file of invalid) {
      console.log(`${colors.yellow}📄 ${file.name}${colors.reset}`);
      console.log(`   ${colors.gray}路径: ${file.path}${colors.reset}`);
      console.log(`   ${colors.gray}层级: ${file.layer}${colors.reset}`);

      // 显示错误
      if (file.errors.length > 0) {
        console.log(`   ${colors.red}错误:${colors.reset}`);
        for (const error of file.errors) {
          console.log(`      - ${error}`);
        }
      }

      // 显示建议
      if (file.suggestions.length > 0) {
        console.log(`   ${colors.cyan}建议:${colors.reset}`);
        for (const suggestion of file.suggestions) {
          console.log(`      - ${suggestion}`);
        }
      }

      // 生成修复建议
      const fixSuggestion = generateFixSuggestion(file.name, file.layer);
      if (fixSuggestion) {
        console.log(`   ${colors.green}修复为:${colors.reset} ${fixSuggestion}`);
      }

      console.log();
    }
  }

  // 总结
  console.log(`${'='.repeat(70)}`);
  if (invalid.length === 0) {
    console.log(`${colors.green}✅ 所有文件均符合命名规范！${colors.reset}`);
  } else {
    console.log(`${colors.yellow}⚠️  发现 ${invalid.length} 个文件不符合命名规范，请修复${colors.reset}`);
  }
  console.log(`${'='.repeat(70)}\n`);
}

/**
 * 主函数
 */
async function main() {
  const options = parseArgs();

  console.log(`${colors.cyan}开始检查文件命名合规性...${colors.reset}\n`);

  if (options.layer) {
    console.log(`${colors.gray}检查范围: ${options.layer} 层${colors.reset}`);
  } else {
    console.log(`${colors.gray}检查范围: 所有层级 (DWS + ADS)${colors.reset}`);
  }

  // 扫描文件
  const files = await scanFiles(options.layer);

  if (files.length === 0) {
    console.log(`\n${colors.yellow}⚠️  未找到任何文件${colors.reset}\n`);
    return;
  }

  // 验证文件
  const valid = [];
  const invalid = [];
  const PROGRESS_THRESHOLD = 50; // 超过此数量才显示进度

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // 大量文件时每 20% 输出一次进度
    if (files.length >= PROGRESS_THRESHOLD && i > 0 && i % Math.ceil(files.length / 5) === 0) {
      const pct = Math.round((i / files.length) * 100);
      process.stdout.write(`\r${colors.gray}  验证进度: ${i}/${files.length} (${pct}%)...${colors.reset}`);
    }

    const layer = detectLayerFromPath(file.path);

    if (!layer) {
      continue;
    }

    const result = validateFileName(file.name, layer);

    if (result.valid) {
      valid.push({ ...file, layer });
    } else {
      invalid.push({
        ...file,
        layer,
        errors: result.errors,
        suggestions: result.suggestions,
      });
    }
  }

  // 清除进度行
  if (files.length >= PROGRESS_THRESHOLD) {
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
  }

  // 打印报告
  printReport({ valid, invalid }, options);

  // 退出码
  process.exit(invalid.length > 0 ? 1 : 0);
}

// 运行主函数
main().catch((error) => {
  console.error(`${colors.red}❌ 错误: ${error.message}${colors.reset}`);
  process.exit(1);
});
