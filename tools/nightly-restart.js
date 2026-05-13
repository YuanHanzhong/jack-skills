#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const REPO_ROOT = '/Users/jack/1_learn';
const HERMES_ROOT = '/Users/jack/.hermes';
const MAX_TRIGGER_FILES = 400;

const DEFAULT_LABELS = [
  {
    label: 'ai.hermes.gateway',
    reason: 'Hermes 主 gateway 读取最新 SOUL/配置',
    statePath: '/Users/jack/.hermes/gateway_state.json',
    triggerPaths: [
      `${HERMES_ROOT}/SOUL.md`,
      `${HERMES_ROOT}/config.yaml`,
      `${HERMES_ROOT}/skills`,
      `${HERMES_ROOT}/scripts`,
      `${HERMES_ROOT}/hermes-agent/gateway`,
      `${REPO_ROOT}/00_DIM/rules`,
      `${REPO_ROOT}/AGENTS.md`,
    ],
  },
  {
    label: 'ai.hermes.gateway.navigator',
    reason: '方向盘 Feishu gateway 读取最新 SOUL/配置',
    statePath: '/Users/jack/.hermes/profiles/navigator/gateway_state.json',
    triggerPaths: [
      `${HERMES_ROOT}/SOUL.md`,
      `${HERMES_ROOT}/profiles/navigator/SOUL.md`,
      `${HERMES_ROOT}/profiles/navigator/config.yaml`,
      `${HERMES_ROOT}/profiles/navigator/skills`,
      `${HERMES_ROOT}/skills`,
      `${HERMES_ROOT}/scripts`,
      `${HERMES_ROOT}/hermes-agent/gateway`,
      `${REPO_ROOT}/00_DIM/rules`,
      `${REPO_ROOT}/AGENTS.md`,
    ],
  },
  {
    label: 'ai.hermes.gateway.explorer',
    reason: '任我行 Feishu gateway 读取最新 SOUL/配置',
    statePath: '/Users/jack/.hermes/profiles/explorer/gateway_state.json',
    triggerPaths: [
      `${HERMES_ROOT}/SOUL.md`,
      `${HERMES_ROOT}/profiles/explorer/SOUL.md`,
      `${HERMES_ROOT}/profiles/explorer/config.yaml`,
      `${HERMES_ROOT}/profiles/explorer/skills`,
      `${HERMES_ROOT}/skills`,
      `${HERMES_ROOT}/scripts`,
      `${HERMES_ROOT}/hermes-agent/gateway`,
      `${REPO_ROOT}/00_DIM/rules`,
      `${REPO_ROOT}/AGENTS.md`,
    ],
  },
  {
    label: 'ai.hermes.gateway.studypartner',
    reason: '学习伙伴 Feishu gateway 读取最新 SOUL/配置',
    statePath: '/Users/jack/.hermes/profiles/studypartner/gateway_state.json',
    triggerPaths: [
      `${HERMES_ROOT}/SOUL.md`,
      `${HERMES_ROOT}/profiles/studypartner/SOUL.md`,
      `${HERMES_ROOT}/profiles/studypartner/config.yaml`,
      `${HERMES_ROOT}/profiles/studypartner/skills`,
      `${HERMES_ROOT}/skills`,
      `${HERMES_ROOT}/scripts`,
      `${HERMES_ROOT}/hermes-agent/gateway`,
      `${REPO_ROOT}/00_DIM/rules`,
      `${REPO_ROOT}/AGENTS.md`,
    ],
  },
  {
    label: 'ai.hermes.gateway.temp',
    reason: '临时 Feishu gateway 读取最新 SOUL/配置',
    statePath: '/Users/jack/.hermes/profiles/temp/gateway_state.json',
    triggerPaths: [
      `${HERMES_ROOT}/SOUL.md`,
      `${HERMES_ROOT}/profiles/temp/SOUL.md`,
      `${HERMES_ROOT}/profiles/temp/config.yaml`,
      `${HERMES_ROOT}/profiles/temp/skills`,
      `${HERMES_ROOT}/skills`,
      `${HERMES_ROOT}/scripts`,
      `${HERMES_ROOT}/hermes-agent/gateway`,
      `${REPO_ROOT}/00_DIM/rules`,
      `${REPO_ROOT}/AGENTS.md`,
    ],
  },
  {
    label: 'com.cc-connect.service',
    reason: 'cc-connect gateway 读取最新平台/agent/项目规则配置',
    triggerPaths: [
      `${homedir()}/.cc-connect/config.toml`,
      `${homedir()}/.cc-connect/config.json`,
      `${homedir()}/.cc-connect/projects`,
      `${REPO_ROOT}/AGENTS.md`,
      `${REPO_ROOT}/00_DIM/rules`,
    ],
  },
  {
    label: 'ai.hermes.gateway.watchdog',
    reason: 'Hermes gateway watchdog 重新加载脚本',
    triggerPaths: [`${HERMES_ROOT}/scripts`, `${HERMES_ROOT}/hermes-agent/gateway`],
  },
  {
    label: 'ai.hermes.feishu-gateways.watchdog',
    reason: 'Feishu gateways watchdog 重新加载脚本',
    triggerPaths: [`${HERMES_ROOT}/scripts`, `${HERMES_ROOT}/hermes-agent/gateway`],
  },
  {
    label: 'ai.hermes.webui.watchdog',
    reason: 'Hermes WebUI watchdog 重新加载脚本',
    triggerPaths: [`${HERMES_ROOT}/scripts`, `${HERMES_ROOT}/hermes-webui`],
  },
];

function domainForUser(uid = process.getuid?.() ?? '') {
  return `gui/${uid}`;
}

function runLaunchctl(args) {
  const result = spawnSync('launchctl', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 2,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  };
}

function expandPath(path) {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function collectMtimes(path, mtimes = [], budget = { count: 0 }) {
  if (budget.count >= MAX_TRIGGER_FILES) return mtimes;
  const expanded = expandPath(path);
  if (!existsSync(expanded)) return mtimes;

  let stat;
  try {
    stat = statSync(expanded);
  } catch {
    return mtimes;
  }

  budget.count += 1;
  mtimes.push({ path: expanded, mtimeMs: stat.mtimeMs });

  if (stat.isDirectory()) {
    for (const child of readdirSync(expanded)) {
      if (budget.count >= MAX_TRIGGER_FILES) break;
      collectMtimes(join(expanded, child), mtimes, budget);
    }
  }

  return mtimes;
}

function serviceStartTimeMs(label, domain) {
  const printed = runLaunchctl(['print', `${domain}/${label}`]);
  if (!printed.ok) return { ok: false, reason: `${domain}/${label} is not loaded` };

  const pidMatch = printed.output.match(/\bpid\s*=\s*(\d+)/);
  if (!pidMatch) return { ok: false, reason: 'service pid unavailable' };

  const started = spawnSync('ps', ['-p', pidMatch[1], '-o', 'lstart='], {
    encoding: 'utf8',
    maxBuffer: 1024 * 256,
  });
  const value = `${started.stdout || ''}${started.stderr || ''}`.trim();
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return { ok: false, reason: `service start time unavailable for pid ${pidMatch[1]}` };
  return { ok: true, startMs: parsed, pid: pidMatch[1] };
}

function restartNeed(item, domain) {
  if (item.changed === true) return { needed: true, reason: 'test override: changed' };
  if (item.changed === false) return { needed: false, reason: 'no restart-relevant changes detected' };
  if (!item.triggerPaths?.length) return { needed: true, reason: 'no trigger paths configured' };

  const start = serviceStartTimeMs(item.label, domain);
  if (!start.ok) return { needed: true, reason: start.reason };

  const mtimes = item.triggerPaths.flatMap((path) => collectMtimes(path));
  const newest = mtimes.reduce((best, current) => (current.mtimeMs > best.mtimeMs ? current : best), {
    path: null,
    mtimeMs: 0,
  });
  if (!newest.path) return { needed: false, reason: 'no existing restart trigger files found' };
  if (newest.mtimeMs <= start.startMs) return { needed: false, reason: 'no restart-relevant changes since service start' };

  return {
    needed: true,
    reason: `restart trigger newer than service start: ${newest.path}`,
  };
}

function ccConnectModelSummary(configPath = `${homedir()}/.cc-connect/config.toml`) {
  if (!existsSync(configPath)) return 'agent=unknown';
  const text = readFileSync(configPath, 'utf8');
  const lines = text.split(/\r?\n/);
  let section = '';
  const values = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.replace(/^\[+|\]+$/g, '');
      continue;
    }
    if (!section.startsWith('projects.agent')) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*"?([^"]+)"?\s*$/);
    if (!match) continue;
    values[match[1]] = match[2];
  }

  const parts = [`agent=${values.type || 'unknown'}`];
  if (values.cmd) parts.push(`cmd=${values.cmd}`);
  if (values.model) parts.push(`model=${values.model}`);
  if (values.reasoning_effort) parts.push(`reasoning=${values.reasoning_effort}`);
  return parts.join('，');
}

function modelSummary(item) {
  if (item.modelInfo) return item.modelInfo;
  if (item.label === 'com.cc-connect.service') return ccConnectModelSummary();
  return '';
}

function readGatewayState(path) {
  if (!path || !existsSync(path)) return { ok: false, reason: 'gateway_state missing' };

  try {
    return { ok: true, data: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { ok: false, reason: `gateway_state unreadable: ${error.message}` };
  }
}

function activeAgentCount(item) {
  const state = readGatewayState(item.statePath);
  if (!item.statePath) return { verified: true, count: 0 };
  if (!state.ok) return { verified: false, count: null, reason: state.reason };
  return {
    verified: true,
    count: Number(state.data.active_agents || 0),
    state: state.data.gateway_state || 'unknown',
  };
}

function restartLabel(item, { domain, dryRun, force, allowGatewayRestart }) {
  const active = activeAgentCount(item);
  const label = item.label;
  const modelInfo = modelSummary(item);
  const withModel = (text) => (modelInfo ? `${text}; ${modelInfo}` : text);
  if (!allowGatewayRestart) {
    return {
      label,
      ok: true,
      skipped: true,
      protected: true,
      output: withModel('skip: service restart requires Jack explicit same-turn authorization'),
    };
  }
  if (!force) {
    const need = restartNeed(item, domain);
    if (!need.needed) {
      return {
        label,
        ok: true,
        skipped: true,
        protected: true,
        output: withModel(`skip: ${need.reason}`),
      };
    }
  }
  if (!force && !active.verified) {
    return {
      label,
      ok: true,
      skipped: true,
      protected: true,
      output: withModel(`skip: cannot verify active_agents (${active.reason})`),
    };
  }
  if (!force && active.count > 0) {
    return {
      label,
      ok: true,
      skipped: true,
      protected: true,
      output: withModel(`skip: active_agents=${active.count}; avoid losing live context`),
    };
  }

  if (dryRun) {
    return {
      label,
      ok: true,
      skipped: false,
      output: withModel(`dry-run: would run launchctl kickstart -k ${domain}/${label}`),
    };
  }

  const exists = runLaunchctl(['print', `${domain}/${label}`]);
  if (!exists.ok) {
    return {
      label,
      ok: true,
      skipped: true,
      output: withModel(`skip: ${domain}/${label} is not loaded`),
    };
  }

  const restarted = runLaunchctl(['kickstart', '-k', `${domain}/${label}`]);
  return {
    label,
    ok: restarted.ok,
    skipped: false,
    output: withModel(restarted.output || `restarted: ${domain}/${label}`),
  };
}

export function runNightlyRestart({
  labels = DEFAULT_LABELS,
  dryRun = false,
  force = false,
  allowGatewayRestart = false,
  domain = domainForUser(),
} = {}) {
  const results = labels.map((item) => ({
    ...item,
    ...restartLabel(item, { domain, dryRun, force, allowGatewayRestart }),
  }));

  return {
    domain,
    dryRun,
    allowGatewayRestart,
    results,
    failed: results.filter((item) => !item.ok).length,
    restarted: results.filter((item) => item.ok && !item.skipped).length,
    skipped: results.filter((item) => item.skipped).length,
    protected: results.filter((item) => item.protected).length,
  };
}

export function formatNightlyRestartReport(result) {
  const lines = [
    '# 夜间服务重启',
    '',
    `- launchd domain: ${result.domain}`,
    `- 模式：${result.dryRun ? 'dry-run' : 'apply'}`,
    `- 已处理：${result.restarted}`,
    `- 跳过：${result.skipped}`,
    `- 受保护跳过：${result.protected}`,
    `- 失败：${result.failed}`,
    '',
    '## 结果',
    '',
  ];

  for (const item of result.results) {
    const marker = item.ok ? (item.skipped ? 'SKIP' : 'OK') : 'FAIL';
    lines.push(`- ${marker} ${item.label}：${item.reason}`);
    if (item.output) lines.push(`  ${item.output}`);
  }

  return `${lines.join('\n')}\n`;
}

function parseArgs(args) {
  return {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    allowGatewayRestart: args.includes('--allow-gateway-restart'),
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp() {
  console.log(`
夜间服务重启

使用方法:
  bun run nightly:restart
  bun run nightly:restart -- --dry-run
  bun run nightly:restart -- --allow-gateway-restart

默认只报告 Hermes / Feishu gateway、cc-connect daemon、watchdog 等桥接服务的重启候选，不重启服务，避免中断执行中的任务。
只有 Jack 当轮明确要求重启 gateway / 桥接服务时，才可传入 --allow-gateway-restart；该模式仍会检查 active_agents，并跳过没有相关规则/配置/脚本变更的健康服务。
如 Jack 明确要求绕过 active_agents 保护，需要同时传入 --force。
`);
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    const result = runNightlyRestart({
      dryRun: options.dryRun,
      force: options.force,
      allowGatewayRestart: options.allowGatewayRestart,
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatNightlyRestartReport(result));
    }
    if (result.failed > 0) process.exitCode = 1;
  }
}
