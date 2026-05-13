#!/usr/bin/env bun

/**
 * Hooks 系统诊断工具
 *
 * 用法:
 *   bun run check-hooks                     # 完整检测
 *   bun run check-hooks --fix               # 自动修复(交互式)
 *   bun run check-hooks --fix --yes         # 自动修复(全自动)
 *   bun run check-hooks --format=json       # JSON 输出
 *   bun run check-hooks --format=markdown   # Markdown 输出
 *   bun run check-hooks --verbose           # 详细输出
 *   bun run check-hooks --quiet             # 只显示错误和警告
 */

import { parseArgs } from 'util';
import { EnvironmentChecker } from './hook-checkers/environment-checker.js';
import { ScriptChecker } from './hook-checkers/script-checker.js';
import { ConfigChecker } from './hook-checkers/config-checker.js';
import { IntegrationChecker } from './hook-checkers/integration-checker.js';
import { AutoFixer } from './hook-fixes/auto-fixes.js';
import { ManualGuides } from './hook-fixes/manual-guides.js';
import { ReportFormatter } from './hook-utils/report-formatter.js';

class HooksChecker {
  constructor(options = {}) {
    this.options = {
      projectRoot: options.projectRoot || process.cwd(),
      format: options.format || 'table',
      fix: options.fix || false,
      yes: options.yes || false,
      verbose: options.verbose || false,
      quiet: options.quiet || false,
    };
  }

  /**
   * 运行完整检测
   */
  async run() {
    const results = {
      environment: null,
      scripts: null,
      config: null,
      integration: null,
      fixes: null,
    };

    try {
      // 1. 环境依赖检测
      if (!this.options.quiet) {
        console.log('🔍 检测环境依赖...');
      }
      results.environment = await EnvironmentChecker.check();

      // 2. Hook 脚本检查
      if (!this.options.quiet) {
        console.log('📝 检查 Hook 脚本...');
      }
      results.scripts = await ScriptChecker.check(this.options.projectRoot);

      // 3. 配置文件验证
      if (!this.options.quiet) {
        console.log('⚙️  验证配置文件...');
      }
      results.config = await ConfigChecker.check(this.options.projectRoot);

      // 4. 功能集成测试
      if (!this.options.quiet) {
        console.log('🧪 功能集成测试...');
      }
      results.integration = await IntegrationChecker.check(this.options.projectRoot);

      // 5. 自动修复(如果启用)
      if (this.options.fix) {
        if (!this.options.quiet) {
          console.log('\n🔧 开始自动修复...');
        }

        results.fixes = await AutoFixer.fix(results, {
          projectRoot: this.options.projectRoot,
          interactive: !this.options.yes,
        });

        if (results.fixes.applied.length > 0) {
          console.log(`\n✅ 已修复 ${results.fixes.applied.length} 个问题`);
        }

        if (results.fixes.failed.length > 0) {
          console.log(`\n❌ ${results.fixes.failed.length} 个问题修复失败`);
        }

        if (results.fixes.skipped.length > 0) {
          console.log(`\n⏭️  跳过 ${results.fixes.skipped.length} 个问题`);
        }
      }

      // 6. 生成报告
      const formatter = new ReportFormatter(this.options.format);
      const report = formatter.generate(results);

      if (!this.options.quiet) {
        console.log(report);
      }

      // 7. 手动修复指导
      if (!this.options.quiet && this.options.format === 'table') {
        const manualIssues = ManualGuides.extractManualIssues(results);
        if (manualIssues.length > 0) {
          console.log(ManualGuides.formatGuides(manualIssues));
        }
      }

      // 8. 退出码
      const hasErrors = this.hasErrors(results);
      return hasErrors ? 1 : 0;
    } catch (error) {
      console.error('❌ 检测过程中发生错误:', error.message);
      if (this.options.verbose) {
        console.error(error.stack);
      }
      return 1;
    }
  }

  /**
   * 检查是否有错误
   */
  hasErrors(results) {
    return (
      (results.environment && results.environment.status === 'error') ||
      (results.scripts && results.scripts.status === 'error') ||
      (results.config && results.config.status === 'error') ||
      (results.integration && results.integration.status === 'error')
    );
  }
}

/**
 * 解析命令行参数
 */
function parseCliArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      fix: {
        type: 'boolean',
        short: 'f',
        default: false,
      },
      yes: {
        type: 'boolean',
        short: 'y',
        default: false,
      },
      format: {
        type: 'string',
        default: 'table',
      },
      verbose: {
        type: 'boolean',
        short: 'v',
        default: false,
      },
      quiet: {
        type: 'boolean',
        short: 'q',
        default: false,
      },
      help: {
        type: 'boolean',
        short: 'h',
        default: false,
      },
    },
    allowPositionals: false,
  });

  return values;
}

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log(`
Hooks 系统诊断工具

用法:
  bun run check-hooks [选项]

选项:
  -f, --fix           自动修复可修复的问题(交互式确认)
  -y, --yes           自动修复所有问题(无需确认)
  --format=<type>     输出格式: table(默认), json, markdown
  -v, --verbose       详细输出
  -q, --quiet         只显示错误和警告
  -h, --help          显示此帮助信息

示例:
  # 完整检测
  bun run check-hooks

  # 自动修复(交互式)
  bun run check-hooks --fix

  # 自动修复(全自动)
  bun run check-hooks --fix --yes

  # JSON 输出(用于 CI/CD)
  bun run check-hooks --format=json

  # Markdown 输出(用于文档)
  bun run check-hooks --format=markdown > hooks-status.md

  # 详细输出
  bun run check-hooks --verbose
`);
}

/**
 * 主函数
 */
async function main() {
  const options = parseCliArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const checker = new HooksChecker(options);
  const exitCode = await checker.run();

  process.exit(exitCode);
}

// 执行
main().catch(error => {
  console.error('❌ 未预期的错误:', error);
  process.exit(1);
});
