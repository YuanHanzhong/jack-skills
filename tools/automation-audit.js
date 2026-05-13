#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { maintenancePlan } from './maintenance.js';

const DEFAULT_CODEX_AUTOMATIONS_DIR = '/Users/jack/.codex/automations';
const LAUNCH_AGENT_PATHS = {
  'com.gbrain.jack.maintain': '/Users/jack/Library/LaunchAgents/com.gbrain.jack.maintain.plist',
  'com.gbrain.jack.dream': '/Users/jack/Library/LaunchAgents/com.gbrain.jack.dream.plist',
};

function issue(id, message) {
  return { id, message };
}

export function analyzeCodexAutomations(automations) {
  const issues = [];
  for (const automation of automations) {
    const text = `${automation.name ?? ''}\n${automation.prompt ?? ''}`;
    const writesHourlyLog = /progress:hourly:apply|hourly-progress\.md|YYYY-MM-DD-hourly-progress\.md/.test(text);
    if (automation.status === 'ACTIVE' && writesHourlyLog) {
      issues.push(issue(
        'codex-hourly-progress-log-active',
        `${automation.id || automation.name} 仍启用 DWS 小时进展日志。`,
      ));
    }
  }
  return issues;
}

export function analyzeMaintenancePlan(plan) {
  const issues = [];
  for (const item of plan.commands || []) {
    if (item.command === 'bun run session:git-sync:push') {
      issues.push(issue('frequent-maintenance-rereads-session-transcript', '高频维护不应通过 session:git-sync 外部重读会话并提交。'));
    }
    if (item.command.startsWith('bun run jp ') && item.command.includes('--push')) {
      issues.push(issue('frequent-maintenance-runs-jp-push', '高频维护不应执行 jp push；jp 总揽推送只属于每日授权维护。'));
    }
  }
  return issues;
}

export function analyzeLaunchAgents(agents) {
  const issues = [];
  const maintain = agents['com.gbrain.jack.maintain'];
  if (maintain?.StartInterval && maintain.StartInterval < 14400) {
    issues.push(issue('gbrain-maintain-too-frequent', 'gbrain maintain 频率高于 4 小时。'));
  }
  if (maintain?.RunAtLoad) {
    issues.push(issue('gbrain-maintain-run-at-load', 'gbrain maintain 仍在加载时立即运行。'));
  }

  const dream = agents['com.gbrain.jack.dream']?.StartCalendarInterval;
  if (dream?.Hour === 4 && dream?.Minute === 0) {
    issues.push(issue('gbrain-dream-collides-with-daily', 'gbrain dream 与每日 04:00 整理冲突。'));
  }
  return issues;
}

function parseTomlString(content, key) {
  const match = content.match(new RegExp(`^${key}\\s*=\\s*"([\\s\\S]*?)"$`, 'm'));
  return match?.[1] ?? '';
}

export function readCodexAutomations(dir = DEFAULT_CODEX_AUTOMATIONS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name, 'automation.toml'))
    .filter((path) => existsSync(path))
    .map((path) => {
      const content = readFileSync(path, 'utf8');
      return {
        path,
        id: parseTomlString(content, 'id'),
        name: parseTomlString(content, 'name'),
        status: parseTomlString(content, 'status'),
        prompt: parseTomlString(content, 'prompt'),
      };
    });
}

function readPlist(path) {
  if (!existsSync(path)) return null;
  const result = spawnSync('plutil', ['-convert', 'json', '-o', '-', path], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return JSON.parse(result.stdout);
}

export function readLaunchAgents(paths = LAUNCH_AGENT_PATHS) {
  return Object.fromEntries(
    Object.entries(paths).map(([label, path]) => [label, readPlist(path)]),
  );
}

export function runAutomationAudit() {
  return [
    ...analyzeCodexAutomations(readCodexAutomations()),
    ...analyzeMaintenancePlan(maintenancePlan('frequent')),
    ...analyzeLaunchAgents(readLaunchAgents()),
  ];
}

function main() {
  const json = process.argv.includes('--json');
  const issues = runAutomationAudit();
  if (json) {
    console.log(JSON.stringify({ ok: issues.length === 0, issues }, null, 2));
  } else if (issues.length === 0) {
    console.log('# 自动化审查\n\n- 状态：通过\n- 问题：0');
  } else {
    console.log('# 自动化审查\n\n- 状态：发现问题');
    issues.forEach((item) => console.log(`- ${item.id}：${item.message}`));
  }
  if (issues.length > 0) process.exitCode = 1;
}

if (import.meta.main) main();
