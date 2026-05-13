#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function formatShanghai(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    full: `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`,
    filePrefix: `${String(values.year).slice(-2)}-${values.month}${values.day}-${values.hour}`,
    canonical: `nightly-maintenance-${values.year}-${values.month}-${values.day}-${values.hour}`,
  };
}

function sleepMs(ms) {
  if (!ms || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function timeoutHint(error, timeoutMs) {
  if (!error) return null;
  if (error.code === 'ETIMEDOUT') return `命令超时（>${Math.round(timeoutMs / 1000)}s）`;
  return `命令异常：${error.message || String(error)}`;
}

function resolveTimeoutMs(command) {
  if (!command) return 10 * 60_000;
  if (command.startsWith('gbrain embed ')) return 8 * 60_000;
  if (command.startsWith('gbrain import ')) return 4 * 60_000;
  if (command.startsWith('gbrain stats')) return 3 * 60_000;
  if (command.startsWith('gbrain doctor')) return 3 * 60_000;
  if (command === 'bun run nightly:restart') return 3 * 60_000;
  return 3 * 60_000;
}

function runCommand(rootDir, command, { timeoutMs } = {}) {
  loadProjectEnv(rootDir);
  const resolvedTimeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : resolveTimeoutMs(command);
  const result = spawnSync(command, {
    cwd: rootDir,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
    timeout: resolvedTimeoutMs,
  });
  const hint = timeoutHint(result.error, resolvedTimeoutMs);
  const mergedOutput = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return {
    title: command,
    command,
    ok: result.status === 0,
    output: hint ? `${hint}\n${mergedOutput}`.trim() : mergedOutput,
  };
}

function resolveRetryDelayMs(attemptIndex = 0) {
  const schedule = [10_000, 30_000, 60_000, 120_000, 300_000];
  return schedule[Math.min(Math.max(0, attemptIndex), schedule.length - 1)];
}

function runCommandWithRetry(
  rootDir,
  command,
  { runCommandFn = runCommand, maxAttempts = 5, retryDelayMs, retryScheduleFn = resolveRetryDelayMs } = {},
) {
  const attempts = [];
  const safeMaxAttempts = Math.max(1, maxAttempts || 1);
  for (let attempt = 1; attempt <= safeMaxAttempts; attempt += 1) {
    const result = runCommandFn(rootDir, command);
    attempts.push(result);
    if (result.ok || attempt === safeMaxAttempts) {
      const outputBlocks = [
        `尝试次数：${attempt}/${safeMaxAttempts}`,
        ...attempts.map((item, index) => {
          const prefix = item.ok ? '✅' : '❌';
          return `\n--- attempt ${index + 1} ${prefix} ---\n${item.output || '无输出'}`;
        }),
      ];
      return {
        ...result,
        title: result.title || command,
        command: result.command || command,
        attempts: attempt,
        maxAttempts: safeMaxAttempts,
        output: outputBlocks.join('\n').trim(),
      };
    }
    const delay = Number.isFinite(retryDelayMs) ? retryDelayMs : retryScheduleFn(attempt - 1);
    sleepMs(delay);
  }
  return { title: command, command, ok: false, attempts: 0, maxAttempts: safeMaxAttempts, output: 'retry loop did not run' };
}

function loadProjectEnv(rootDir = DEFAULT_ROOT_DIR) {
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

function truncate(text, max = 5000) {
  if (!text || text.length <= max) return text || '无输出';
  return `${text.slice(0, max)}\n\n...已截断 ${text.length - max} 字符`;
}

export function writeNightlyReport({
  rootDir = DEFAULT_ROOT_DIR,
  now = new Date(),
  sections,
} = {}) {
  const time = formatShanghai(now);
  const reportDir = join(rootDir, '03_DWS', 'sessions', '知识库日报');
  const fileName = `${time.filePrefix}-知识库夜间整理报告.md`;
  const fullPath = join(reportDir, fileName);
  const relativePath = normalizePath(relative(rootDir, fullPath));
  mkdirSync(reportDir, { recursive: true });

  const failed = sections.filter((section) => !section.ok);
  const content = [
    '---',
    '层级: DWS',
    '类型: 知识库日报',
    `created: ${time.filePrefix}`,
    `updated: ${time.filePrefix}`,
    `canonical_id: ${time.canonical}`,
    'aliases:',
    `  - 知识库夜间整理 ${time.full}`,
    'relations: []',
    'tags: ["知识库日报", "夜间整理", "自动化"]',
    '---',
    '',
    '# 知识库夜间整理报告',
    '',
    '## 当前结论',
    '',
    failed.length === 0
      ? '本次夜间整理命令全部执行完成；详情见下方精确时间线和命令输出。'
      : `本次夜间整理有 ${failed.length} 个命令失败，需要后续处理。`,
    '',
    '## 精确时间线',
    '',
    `- ${time.full}：执行知识库夜间整理，生成 DWS 日报。`,
    '',
    '## 关联内容',
    '',
    '- 驱动来源：`00_DIM/rules/夜间整理规范.md`',
    '- 维护入口：`tools/maintenance.js`',
    '- 重载候选入口：`tools/nightly-restart.js`',
    '',
    '## 原始证据',
    '',
    '- 命令输出：本文件下方各命令区块。',
    '',
    '## 命令结果',
    '',
    ...sections.flatMap((section) => [
      `### ${section.ok ? '✅' : '❌'} ${section.title}`,
      '',
      `命令：\`${section.command}\``,
      '',
      '```text',
      truncate(section.output),
      '```',
      '',
    ]),
  ].join('\n');

  writeFileSync(fullPath, content, 'utf8');
  return { path: relativePath, failed: failed.length };
}

export function runNightlyReport({
  rootDir = DEFAULT_ROOT_DIR,
  now = new Date(),
  runCommandFn = runCommand,
  maxAttempts = 5,
  retryDelayMs = 60_000,
  commands = [
    'bun run maintenance:frequent:apply',
    'bun run state:maintain:apply',
    'bun run rules:health',
    'bun run knowledge:health',
    'bun run search:eval',
    'bun run flashcard',
    'bun run hermes:skills:doctor',
    'gbrain doctor --json',
    'gbrain import /Users/jack/1_learn --no-embed',
    'gbrain embed --stale',
    'gbrain stats',
    'bun run nightly:restart',
  ],
} = {}) {
  const sections = [];
  for (const command of commands) {
    console.log(`\n# nightly:run ${command}\n`);
    const section = runCommandWithRetry(rootDir, command, { runCommandFn, maxAttempts, retryDelayMs });
    console.log(`# nightly:done ${command} -> ${section.ok ? 'OK' : 'FAIL'} (attempts ${section.attempts}/${section.maxAttempts})`);
    sections.push(section);
  }
  return writeNightlyReport({ rootDir, now, sections });
}

async function main() {
  const result = runNightlyReport();
  console.log(`# 夜间整理报告已生成\n\n- 路径：${result.path}\n- 失败命令：${result.failed}`);
  if (result.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('tools/nightly-report.js')) {
  main().catch((error) => {
    console.error(`❌ 夜间报告生成失败：${error.message}`);
    process.exit(1);
  });
}
