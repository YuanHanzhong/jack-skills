#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { analyzeEvolution } from './evolution-core.js';
import { runAudit } from './rule-auditor.js';

function runCommand(label, command, args) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    label,
    command: [command, ...args].join(' '),
    status: result.status ?? 1,
    ok: result.status === 0,
    elapsedMs: Date.now() - startedAt,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function summarizeCommand(result) {
  const mark = result.ok ? '✅' : '❌';
  const lines = [
    `## ${mark} ${result.label}`,
    '',
    `- 命令：\`${result.command}\``,
    `- 退出码：${result.status}`,
    `- 耗时：${result.elapsedMs}ms`,
  ];

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (output) {
    const compact = output.split('\n').slice(-18).join('\n');
    lines.push('', '```text', compact, '```');
  }

  return lines.join('\n');
}

async function main() {
  const checks = [
    runCommand('自我进化单元测试', 'bun', [
      'test',
      'tools/evolution-core.test.js',
      'tools/memory-inject-instinct.test.js',
    ]),
    runCommand('规则执行器测试', 'bun', ['tools/test-rule-enforcer.js']),
    runCommand('Hermes 技能索引健康', 'bun', ['run', 'hermes:skills:doctor']),
  ];

  const audit = await runAudit({ quick: true });
  const evolution = analyzeEvolution({ rootDir: process.cwd() });

  const failedChecks = checks.filter((item) => !item.ok);
  const triggerIssues = evolution.triggers.issues;
  const auditFailures = audit.failed;
  const auditWarnings = audit.warned;

  const lines = [
    '# 规则执行健康巡检',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 测试失败：${failedChecks.length}`,
    `- Hook 触发器问题：${triggerIssues.length}`,
    `- 快速审计失败：${auditFailures.length}`,
    `- 快速审计警告：${auditWarnings.length}`,
    '',
    '## 结论',
    '',
  ];

  if (failedChecks.length === 0 && triggerIssues.length === 0 && auditFailures.length === 0) {
    lines.push('- ✅ 规则识别、执行器测试、Hook 触发器均正常。');
  } else {
    lines.push('- ⚠️ 巡检发现问题；本命令保持 0 退出码，方便定时任务持续输出报告。');
  }

  lines.push(
    '',
    '## Hook 覆盖',
    '',
    `- Write/Edit 执行器：${evolution.triggers.coverage.writeEditEnforcer ? '✅' : '❌'}`,
    `- Bash 执行器：${evolution.triggers.coverage.bashEnforcer ? '✅' : '❌'}`,
    `- 规则文件校验：${evolution.triggers.coverage.validateRules ? '✅' : '❌'}`,
    `- Stop 快速审计：${evolution.triggers.coverage.stopAudit ? '✅' : '❌'}`,
    `- Prompt 错误模式注入：${evolution.triggers.coverage.promptContextHook ? '✅' : '❌'}`
  );

  if (triggerIssues.length > 0) {
    lines.push('', '## Hook 问题', '');
    for (const issue of triggerIssues) {
      lines.push(`- ❌ ${issue.type}：${issue.recommendation}`);
    }
  }

  lines.push('', '## 命令测试', '');
  for (const check of checks) {
    lines.push(summarizeCommand(check), '');
  }

  lines.push('## 快速审计', '');
  if (auditFailures.length === 0 && auditWarnings.length === 0) {
    lines.push('- ✅ 快速审计无失败或警告');
  } else {
    for (const item of auditFailures) {
      lines.push(`- ❌ ${item.name}：${item.details}`);
    }
    for (const item of auditWarnings) {
      lines.push(`- ⚠️ ${item.name}：${item.details}`);
    }
  }

  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.log(`# 规则执行健康巡检\n\n- ❌ 巡检脚本异常：${error.message}`);
  process.exit(0);
});
