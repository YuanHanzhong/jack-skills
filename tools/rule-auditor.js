#!/usr/bin/env node

/**
 * rule-auditor.js
 * 统一规则审计器 — 检查 17 条规则的执行状况
 *
 * 用法：
 *   bun run audit              # 完整扫描（详细输出）
 *   bun run audit --quick      # 快速扫描（Stop hook 用，< 2s）
 *   bun run audit --verbose    # 详细模式（显示每条规则的检查细节）
 *   bun run audit --json       # JSON 输出（供其他工具消费）
 *
 * API：
 *   import { runAudit } from './rule-auditor.js'
 *   const result = await runAudit({ quick: true })
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || join(__dirname, '..');

/**
 * 加载审计配置
 */
function loadConfig() {
  const configPath = join(__dirname, 'rule-auditor-config.json');
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

/**
 * 动态加载单个 auditor 模块
 */
async function loadAuditor(modulePath) {
  const fullPath = join(__dirname, modulePath.replace('./', ''));
  const mod = await import(fullPath);
  return mod.default;
}

/**
 * 运行单个审计检查（带超时和 fail-open）
 */
async function runSingleAudit(auditorConfig, projectRoot, timeoutMs = 5000) {
  try {
    const auditor = await loadAuditor(auditorConfig.module);
    const result = await Promise.race([
      auditor.check(projectRoot),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
      ),
    ]);
    return {
      id: auditorConfig.id,
      name: auditorConfig.name,
      ...result,
    };
  } catch (error) {
    // fail-open: 审计器自身崩溃不影响其他检查
    return {
      id: auditorConfig.id,
      name: auditorConfig.name,
      status: 'error',
      details: `审计器异常: ${error.message}`,
      items: [],
    };
  }
}

/**
 * 主审计入口
 * @param {Object} options
 * @param {boolean} options.quick - 快速模式（仅运行 quick=true 的检查）
 * @param {boolean} options.verbose - 详细输出
 * @param {boolean} options.json - JSON 输出
 * @returns {Object} { passed, failed, warned, errors, results, checklists }
 */
export async function runAudit(options = {}) {
  const { quick = false, verbose = false } = options;
  const config = loadConfig();

  // 筛选要运行的 auditors
  let auditors = config.auditors;
  if (quick) {
    auditors = auditors.filter(a => a.quick);
  }

  // 并行运行所有检查
  const timeoutMs = quick ? 2000 : 5000;
  const results = await Promise.all(
    auditors.map(a => runSingleAudit(a, PROJECT_ROOT, timeoutMs))
  );

  // 统计
  const passed = results.filter(r => r.status === 'pass');
  const failed = results.filter(r => r.status === 'fail');
  const warned = results.filter(r => r.status === 'warn');
  const errors = results.filter(r => r.status === 'error');

  return {
    passed,
    failed,
    warned,
    errors,
    results,
    checklists: config.checklists,
    quick,
    verbose,
  };
}

/**
 * 格式化紧凑输出（Stop hook 用）
 */
function formatCompact(audit) {
  const { passed, failed, warned } = audit;
  const parts = [];

  parts.push(`${passed.length}✅`);
  if (warned.length > 0) parts.push(`${warned.length}⚠️`);
  if (failed.length > 0) parts.push(`${failed.length}❌`);

  let line = `📋 规则审计: ${parts.join(' ')}`;

  if (failed.length > 0) {
    line += ` | 失败: ${failed.map(f => f.name).join(', ')}`;
  }

  return line;
}

/**
 * 格式化详细输出（手动运行用）
 */
function formatDetailed(audit) {
  const { passed, failed, warned, errors, checklists, verbose } = audit;
  const lines = ['📋 规则审计报告', ''];

  // 通过的规则
  if (passed.length > 0) {
    lines.push(`✅ 通过 (${passed.length}): ${passed.map(p => p.name).join(', ')}`);
  }

  // 警告
  if (warned.length > 0) {
    lines.push('');
    lines.push(`⚠️ 警告 (${warned.length}):`);
    for (const w of warned) {
      lines.push(`  - ${w.name}: ${w.details}`);
      if (verbose && w.items?.length > 0) {
        for (const item of w.items) {
          lines.push(`    · ${item}`);
        }
      }
    }
  }

  // 失败
  if (failed.length > 0) {
    lines.push('');
    lines.push(`❌ 失败 (${failed.length}):`);
    for (const f of failed) {
      lines.push(`  - ${f.name}: ${f.details}`);
      if (verbose && f.items?.length > 0) {
        for (const item of f.items) {
          lines.push(`    · ${item}`);
        }
      }
    }
  }

  // 错误（审计器自身问题）
  if (errors.length > 0) {
    lines.push('');
    lines.push(`🔧 审计器异常 (${errors.length}):`);
    for (const e of errors) {
      lines.push(`  - ${e.name}: ${e.details}`);
    }
  }

  // Checklist（自查项）
  if (checklists && checklists.length > 0) {
    lines.push('');
    lines.push('📝 自查:');
    for (const cl of checklists) {
      lines.push(`  ${cl.name}: ${cl.items.join(' ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * CLI 入口
 */
async function main() {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const verbose = args.includes('--verbose');
  const jsonOutput = args.includes('--json');

  const startTime = Date.now();
  const audit = await runAudit({ quick, verbose });
  const elapsed = Date.now() - startTime;

  if (jsonOutput) {
    console.log(JSON.stringify({
      ...audit,
      elapsedMs: elapsed,
    }, null, 2));
    return;
  }

  if (quick) {
    console.log(formatCompact(audit));
  } else {
    console.log(formatDetailed(audit));
    console.log(`\n⏱️ 耗时: ${elapsed}ms`);
  }

  // 退出码：有 fail 则非零
  if (audit.failed.length > 0) {
    process.exit(1);
  }
}

// 仅在直接运行时执行 CLI
const isDirectRun = process.argv[1] &&
  (process.argv[1].includes('rule-auditor') ||
   process.argv[1] === fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch(err => {
    console.error(`[rule-auditor] 致命错误: ${err.message}`);
    process.exit(0); // fail-open
  });
}
