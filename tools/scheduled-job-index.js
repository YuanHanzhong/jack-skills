#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const HERMES_HOME = '/Users/jack/.hermes';
const CODEX_AUTOMATIONS_DIR = '/Users/jack/.codex/automations';
const LAUNCH_AGENT_DIR = '/Users/jack/Library/LaunchAgents';
const OUTPUT_PATH = '00_DIM/自动化任务索引.md';

const LAUNCH_AGENT_LABELS = [
  'ai.hermes.feishu-gateways.watchdog',
  'ai.hermes.webui.watchdog',
  'com.cc-connect.service',
  'com.gbrain.jack.maintain',
  'com.gbrain.jack.dream',
  'com.gbrain.jack.health',
  'com.jack.kimi-rules.timer',
  'com.jack.kimi-rules.watch',
];

function parseTomlString(content, key) {
  const match = content.match(new RegExp(`^${key}\\s*=\\s*"([\\s\\S]*?)"$`, 'm'));
  return match?.[1] ?? '';
}

function firstSentence(text = '') {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 90);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function listHermesCronJobs() {
  const roots = [join(HERMES_HOME, 'cron')];
  const profilesDir = join(HERMES_HOME, 'profiles');
  if (existsSync(profilesDir)) {
    for (const profile of readdirSync(profilesDir)) {
      roots.push(join(profilesDir, profile, 'cron'));
    }
  }

  const rows = [];
  for (const root of roots) {
    const jobsPath = join(root, 'jobs.json');
    if (!existsSync(jobsPath)) continue;
    const profile = root.includes('/profiles/')
      ? root.split('/profiles/')[1].split('/')[0]
      : 'global';
    for (const job of readJson(jobsPath).jobs || []) {
      rows.push({
        source: 'Hermes cron',
        owner: profile,
        id: job.id,
        name: job.name || job.id,
        schedule: job.schedule_display || job.schedule?.display || '',
        enabled: job.enabled !== false,
        state: job.state || '',
        lastStatus: job.last_status || '',
        lastError: job.last_error || '',
        nextRun: job.next_run_at || '',
        action: job.script ? `script: ${job.script}` : firstSentence(job.prompt),
        authority: jobsPath,
      });
    }
  }
  return rows;
}

function listCodexAutomations() {
  if (!existsSync(CODEX_AUTOMATIONS_DIR)) return [];
  return readdirSync(CODEX_AUTOMATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(CODEX_AUTOMATIONS_DIR, entry.name, 'automation.toml'))
    .filter((path) => existsSync(path))
    .map((path) => {
      const content = readFileSync(path, 'utf8');
      return {
        source: 'Codex automation',
        owner: parseTomlString(content, 'id'),
        id: parseTomlString(content, 'id'),
        name: parseTomlString(content, 'name'),
        schedule: parseTomlString(content, 'rrule'),
        enabled: parseTomlString(content, 'status') === 'ACTIVE',
        state: parseTomlString(content, 'status'),
        lastStatus: '',
        lastError: '',
        nextRun: '',
        action: firstSentence(parseTomlString(content, 'prompt')),
        authority: path,
      };
    });
}

function plistToJson(path) {
  const result = spawnSync('plutil', ['-convert', 'json', '-o', '-', path], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout);
}

function scheduleFromPlist(plist) {
  if (plist.StartInterval) return `every ${Math.round(plist.StartInterval / 60)}m`;
  if (plist.StartCalendarInterval) {
    const item = Array.isArray(plist.StartCalendarInterval)
      ? plist.StartCalendarInterval[0]
      : plist.StartCalendarInterval;
    const weekday = item.Weekday ? ` weekday=${item.Weekday}` : '';
    return `${String(item.Hour ?? 0).padStart(2, '0')}:${String(item.Minute ?? 0).padStart(2, '0')}${weekday}`;
  }
  if (plist.RunAtLoad) return 'RunAtLoad';
  if (plist.KeepAlive) return 'KeepAlive';
  return '';
}

function listLaunchAgents() {
  return LAUNCH_AGENT_LABELS
    .map((label) => {
      const path = join(LAUNCH_AGENT_DIR, `${label}.plist`);
      if (!existsSync(path)) return null;
      const plist = plistToJson(path);
      if (!plist) return null;
      return {
        source: 'launchd',
        owner: label,
        id: label,
        name: label,
        schedule: scheduleFromPlist(plist),
        enabled: true,
        state: plist.RunAtLoad ? 'RunAtLoad' : 'loaded-config',
        lastStatus: '',
        lastError: '',
        nextRun: '',
        action: (plist.ProgramArguments || []).join(' '),
        authority: path,
      };
    })
    .filter(Boolean);
}

export function classifyJob(job) {
  const text = `${job.name} ${job.action}`.toLowerCase();
  if (/复习|learning|wrapper/.test(text)) return '学习复习';
  if (/fan|风扇/.test(text)) return '硬件控制';
  if (/flclash|kimi-rules/.test(text)) return '网络守护';
  if (/gateway|cc-connect|watchdog|webui/.test(text)) return 'Gateway/守护';
  if (/审计|audit|rules:health|health/.test(text)) return '配置审计';
  if (/maintenance|知识库|gbrain|dream|daily|weekly|整理/.test(text)) return '知识库维护';
  return '其他';
}

export function assessJob(job) {
  const text = `${job.name} ${job.action}`;
  if (!job.enabled || /PAUSED|disabled/i.test(job.state)) return '停用或历史保留，不参与当前排期。';
  if (job.lastStatus === 'error') return `需修复：上次失败 ${firstSentence(job.lastError)}`;
  if (/重启所有飞书Gateway/.test(text)) return '不合理：无人值守重启 gateway 违反显式授权边界，应改为审计或候选报告。';
  if (/every 5m|every 10m|StartInterval.*300|\*\/5/.test(`${job.schedule} ${text}`)) {
    return '高频任务只适合轻量、幂等、静默守护；需要有失败退避和人工恢复路径。';
  }
  if (/04:00|BYHOUR=4/.test(job.schedule) && /整理|update|更新|maintenance/.test(text)) {
    return '夜间维护窗口任务；注意与 03:00、04:30、05:00 任务错峰。';
  }
  if (/05:/.test(job.schedule) && /审计|audit/.test(text)) return '适合作为夜间维护后的配置审计，但不应携带重启动作。';
  return '当前未发现明显时间冲突；后续按类别维护。';
}

function sortKey(job) {
  const s = job.schedule || '';
  const hm = s.match(/(?:BYHOUR=|^|\\s)(\\d{1,2})(?::|;BYMINUTE=|\\s)(\\d{1,2})?/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);
  if (/HOURLY|every|INTERVAL/.test(s)) return 24 * 60;
  return 25 * 60;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\n/g, ' ').replace(/\|/g, '\\|');
}

export function collectScheduledJobs() {
  return [
    ...listHermesCronJobs(),
    ...listCodexAutomations(),
    ...listLaunchAgents(),
  ].sort((a, b) => sortKey(a) - sortKey(b) || a.source.localeCompare(b.source));
}

export function renderScheduledJobIndex(jobs = collectScheduledJobs()) {
  const rows = jobs.map((job) => ({
    ...job,
    category: classifyJob(job),
    assessment: assessJob(job),
  }));
  const active = rows.filter((row) => row.enabled).length;
  const problematic = rows.filter((row) => /^需修复|不合理/.test(row.assessment)).length;

  const table = [
    '| 来源 | Profile/Label | 时间/周期 | 分类 | 任务 | 状态 | 最近结果 | 具体动作 | 合理性 / 调整建议 | 权威文件 |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((row) => [
      row.source,
      row.owner,
      row.schedule,
      row.category,
      row.name,
      row.enabled ? row.state || 'active' : row.state || 'disabled',
      row.lastStatus || '-',
      row.action,
      row.assessment,
      row.authority,
    ].map(escapeCell).join(' | ')).map((line) => `| ${line} |`),
  ].join('\n');

  return `---\n层级: DIM\n类型: 自动化索引\ncreated: 2026-05-11\nupdated: 2026-05-11\nstatus: active\n---\n\n# 自动化与定时任务索引\n\n> 生成命令：\`bun run schedule:index -- --write\`。定时任务文件、cron jobs、LaunchAgent 或 Codex automation 发生变更后，必须重新生成本索引；不要手写表格。\n\n## 摘要\n\n- 当前记录任务数：${rows.length}\n- 当前启用任务数：${active}\n- 需要处理的问题数：${problematic}\n- 维护原则：系统维护、配置审计、知识库整理、学习提醒、硬件控制和网络守护分开管理；无人值守任务默认只做轻量、幂等、可恢复动作。\n\n## 总表\n\n${table}\n`;
}

function main() {
  const markdown = renderScheduledJobIndex();
  if (process.argv.includes('--write')) {
    writeFileSync(OUTPUT_PATH, markdown);
    console.log(`wrote ${OUTPUT_PATH}`);
  } else {
    console.log(markdown);
  }
}

if (import.meta.main) main();
