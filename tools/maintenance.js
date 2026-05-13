#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const AUTO_FIXES = {
  frequent: [
    {
      id: 'refresh-index',
      match: /\bbun run index\b/,
      command: 'bun run index',
      reason: '刷新索引（state:maintain 建议）',
    },
  ],
};

const PLANS = {
  frequent: {
    label: '高频轻量维护',
    cadence: '每 4 小时或口头触发',
    commands: [
      { command: 'bun run direction:watchdog', reason: '检测方向盘变化' },
      { command: 'bun run direction:sync:apply', reason: '直接同步方向盘到 ADS（无待同步时为 no-op）' },
      { command: 'bun run check --layer=ADS', reason: '提交前检查 ADS 目录和文件命名是否符合规范' },
      { command: 'bun run ads:review', reason: '提交前检查已完成任务是否仍滞留在进行中；如有候选，必须先模型总结并移动再提交' },
      { command: 'bun run state:maintain', reason: '提交前检查方向盘、ADS、索引和健康维护建议' },
      { command: 'bun run progress:hourly:apply', reason: '按变化文件生成分组提交说明，并执行本地 git commit（不 push）' },
      { command: 'bun run session:worktree:merge:apply', reason: '无冲突合并已推送的会话 worktree 分支，并清理临时分支' },
    ],
  },
  daily: {
    label: '每日整理',
    cadence: '每天凌晨 04:00',
    commands: [
      { command: 'bun run nightly:report', reason: '执行大而全夜间整理、报告服务重载候选，并持久化 DWS 日志' },
    ],
  },
  weekly: {
    label: '每周深度维护',
    cadence: '每周一 03:00',
    commands: [
      { command: 'bun run history:migrate', reason: 'dry-run 检查历史结构是否仍需迁移' },
      { command: 'bun run knowledge:health', reason: '完整健康巡检' },
      { command: 'bun run hermes:skills:doctor', reason: '确认 Hermes 技能索引仍匹配唯一真实源' },
      { command: 'bun run search:eval', reason: '检索评估回归' },
      { command: 'gbrain doctor --json', reason: 'gbrain 数据库健康检查' },
      { command: 'gbrain import /Users/jack/1_learn --no-embed', reason: 'gbrain 无 embedding 增量导入' },
    ],
  },
  manual: {
    label: '手动高风险维护',
    cadence: '仅明确要求时',
    commands: [
      { command: 'bun run history:migrate:apply', reason: '批量改写历史 DWD/DWS/ADS 结构' },
      { command: 'bun run memory:rebuild:force', reason: '强制重建本地向量索引' },
      { command: 'gbrain embed --stale', reason: '需要 embedding provider API key，生成 gbrain embeddings' },
      { command: 'gbrain skillpack install --all', reason: '安装 gbrain 可选技能包，必须用户明确同意' },
    ],
  },
};

export function maintenancePlan(name = 'daily') {
  const plan = PLANS[name];
  if (!plan) {
    throw new Error(`未知维护级别：${name}`);
  }
  return plan;
}

function printPlan(plan, name) {
  console.log(`# ${plan.label}`);
  console.log('');
  console.log(`- 级别：${name}`);
  console.log(`- 建议频率：${plan.cadence}`);
  console.log('');
  console.log('## 命令');
  console.log('');
  plan.commands.forEach((item) => {
    console.log(`- \`${item.command}\`：${item.reason}`);
  });
}

export function collectAutoFixes(planName, output) {
  const candidates = AUTO_FIXES[planName] ?? [];
  return candidates.filter((item) => item.match.test(output ?? ''));
}

function runAutoFixes(planName, output, executedFixes) {
  const fixes = collectAutoFixes(planName, output).filter((fix) => !executedFixes.has(fix.id));
  for (const fix of fixes) {
    executedFixes.add(fix.id);
    const result = spawnSync(fix.command, {
      shell: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    });
    console.log(`\n## ${result.status === 0 ? '🛠️' : '❌'} auto-fix: ${fix.command}\n`);
    if (fix.reason) console.log(`原因：${fix.reason}\n`);
    console.log(result.stdout || result.stderr || '无输出');
    if (result.status !== 0) return result.status;
  }
  return 0;
}

function runPlan(plan, planName) {
  loadProjectEnv();
  const results = [];
  const executedFixes = new Set();
  for (const item of plan.commands) {
    const result = spawnSync(item.command, {
      shell: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    });
    results.push({ ...item, status: result.status, stdout: result.stdout, stderr: result.stderr });
    console.log(`\n## ${result.status === 0 ? '✅' : '❌'} ${item.command}\n`);
    console.log(result.stdout || result.stderr || '无输出');
    if (result.status !== 0) break;

    if (planName && AUTO_FIXES[planName]) {
      const status = runAutoFixes(planName, `${result.stdout ?? ''}\n${result.stderr ?? ''}`, executedFixes);
      if (status !== 0) break;
    }
  }
  return results;
}

function loadProjectEnv(rootDir = process.cwd()) {
  const envPath = join(rootDir, '.env');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function main() {
  const args = process.argv.slice(2);
  const name = args.find((arg) => !arg.startsWith('--')) || 'daily';
  const apply = args.includes('--apply');
  const plan = maintenancePlan(name);
  if (!apply) {
    printPlan(plan, name);
    return;
  }
  const results = runPlan(plan, name);
  const failed = results.filter((item) => item.status !== 0);
  if (failed.length > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('tools/maintenance.js')) {
  try {
    main();
  } catch (error) {
    console.error(`❌ 维护入口失败：${error.message}`);
    process.exit(1);
  }
}
