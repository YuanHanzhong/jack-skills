#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';

import { analyzeAdsStateReview } from './ads-state-review.js';
import { collectChangedFiles, inferBottleneck, unsafePathReason } from './hourly-progress.js';

const DEFAULT_ROOT_DIR = join(import.meta.dir, '..');
const DEFAULT_SESSIONS_DIR = join(process.env.HOME || '/Users/jack', '.codex', 'sessions');
const DEFAULT_INACTIVE_MINUTES = 30;
const DEFAULT_LOOKBACK_DAYS = 3;

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function runGit(rootDir, args, { allowFail = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });

  if (!allowFail && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function statePath(rootDir) {
  const gitDir = runGit(rootDir, ['rev-parse', '--git-dir']).stdout.trim();
  const absoluteGitDir = isAbsolute(gitDir) ? gitDir : join(rootDir, gitDir);
  return join(absoluteGitDir, 'codex-session-git-sync-state.json');
}

function ensureBranchCanPush(rootDir, branch) {
  const remote = runGit(rootDir, ['remote', 'get-url', 'origin'], { allowFail: true });
  if (!remote.ok) {
    return {
      ok: false,
      message: '没有配置 origin remote，不能保证 commit 后同步 push。',
    };
  }

  runGit(rootDir, ['fetch', 'origin', branch], { allowFail: true });
  const remoteRef = runGit(rootDir, ['rev-parse', '--verify', `origin/${branch}`], { allowFail: true });
  if (!remoteRef.ok) return { ok: true };

  const aheadBehind = runGit(rootDir, ['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`]).stdout
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));
  const behind = aheadBehind[1] || 0;
  if (behind > 0) {
    return {
      ok: false,
      message: `origin/${branch} 领先本地 ${behind} 个提交，已在 commit 前阻塞，避免产生无法立即 push 的本地提交。`,
    };
  }

  return { ok: true };
}

function listJsonlFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) listJsonlFiles(fullPath, files);
    else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
  return files;
}

function textFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => item?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function firstLine(text, maxLength = 80) {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength - 1)}…`;
}

export function parseSessionFile(path) {
  const stat = statSync(path);
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const session = {
    id: null,
    path,
    cwd: null,
    startTime: null,
    lastActivity: stat.mtime,
    mtimeMs: stat.mtimeMs,
    userMessages: [],
    assistantMessages: [],
  };

  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.timestamp) {
      const timestamp = new Date(event.timestamp);
      if (!Number.isNaN(timestamp.getTime())) session.lastActivity = timestamp;
    }

    if (event.type === 'session_meta') {
      session.id = event.payload?.id || session.id;
      session.cwd = event.payload?.cwd || session.cwd;
      session.startTime = event.payload?.timestamp || event.timestamp || session.startTime;
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'user_message') {
      const text = event.payload.message?.trim();
      if (text) session.userMessages.push(text);
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'agent_message') {
      const text = event.payload.message?.trim();
      if (text) session.assistantMessages.push(text);
      continue;
    }

    if (event.type === 'response_item' && event.payload?.type === 'message') {
      const role = event.payload.role;
      const text = textFromContent(event.payload.content);
      if (role === 'assistant' && text) session.assistantMessages.push(text);
    }
  }

  return session;
}

export function findProjectSessions({ rootDir, sessionsDir, now = new Date(), lookbackDays = DEFAULT_LOOKBACK_DAYS }) {
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  const resolvedRoot = canonicalPath(rootDir);
  return listJsonlFiles(sessionsDir)
    .filter((path) => statSync(path).mtimeMs >= cutoff)
    .map((path) => parseSessionFile(path))
    .filter((session) => session.cwd && canonicalPath(session.cwd) === resolvedRoot)
    .sort((a, b) => b.lastActivity - a.lastActivity);
}

export function selectInactiveCandidate({ sessions, state, now = new Date(), inactiveMinutes = DEFAULT_INACTIVE_MINUTES }) {
  const latest = sessions[0] || null;
  if (!latest) return { status: 'no-session', message: '没有找到当前仓库的 Codex 会话。' };

  const inactiveMs = Math.max(0, now.getTime() - latest.lastActivity.getTime());
  if (inactiveMs < inactiveMinutes * 60 * 1000) {
    return {
      status: 'latest-active',
      message: `最新会话仍活跃，距离上次更新 ${Math.floor(inactiveMs / 60000)} 分钟。`,
      latest,
    };
  }

  const processed = state.sessions?.[latest.id];
  if (processed && processed.mtimeMs >= latest.mtimeMs) {
    return {
      status: 'already-processed',
      message: '最新非活跃会话已经处理过。',
      latest,
    };
  }

  return {
    status: 'candidate',
    message: '找到超过不活跃阈值的会话。',
    latest,
  };
}

function categoryForPath(path) {
  if (path.startsWith('00_方向盘/')) return '方向盘';
  if (path.startsWith('04_ADS/')) return 'ADS任务进展';
  if (path.startsWith('03_DWS/')) return 'DWS沉淀与蓝图';
  if (path.startsWith('02_DWD/')) return 'DWD分析';
  if (path.startsWith('00_DIM/')) return 'DIM规则与记忆';
  if (path.startsWith('tools/')) return '工具自动化';
  if (path === 'package.json') return '命令入口';
  return '其他工程文件';
}

function categoriesForChanges(changes) {
  const map = new Map();
  for (const change of changes) {
    const category = categoryForPath(change.path);
    const item = map.get(category) || { category, count: 0, files: [] };
    item.count += 1;
    item.files.push(change.path);
    map.set(category, item);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function inferTopic(session, categories) {
  const firstUser = session.userMessages.find(Boolean);
  if (firstUser) return firstLine(firstUser, 46);
  if (categories.length === 1) return categories[0].category;
  return `${categories[0]?.category || '知识库'}等${categories.length}类进展`;
}

function formatCategoryLines(categories) {
  return categories.map((item) => `- ${item.category}：${item.count} 个文件（${item.files.join('、')}）`);
}

function buildPublicReasoningSummary(session, categories) {
  const latestUser = session.userMessages.at(-1);
  const latestAssistant = session.assistantMessages.at(-1);
  const lines = [
    `- 用户目标：${firstLine(latestUser || session.userMessages[0] || '未提取到用户目标', 90)}`,
    `- 执行判断：按会话不活跃阈值收口，不按固定小时切分提交。`,
    `- 修改归因：本次 Git 变更主要落在 ${categories.map((item) => item.category).join('、') || '未分类文件'}。`,
  ];

  if (latestAssistant) {
    lines.push(`- 公开结论：${firstLine(latestAssistant, 90)}`);
  }

  return lines;
}

function formatCommitMessage({ session, topic, categories, bottleneck }) {
  const subject = `chore: ${topic}`;
  const body = [
    '本次自动提交来自非活跃会话收口任务。',
    '',
    `会话：${session.id}`,
    `会话文件：${normalizePath(session.path)}`,
    `主题：${topic}`,
    '',
    `战略瓶颈进展：${bottleneck}`,
    '',
    '公开推理摘要（非隐藏思维链）：',
    ...buildPublicReasoningSummary(session, categories),
    '',
    '按主题分组的变更文件：',
    ...formatCategoryLines(categories),
  ].join('\n');

  return { subject, body };
}

function markSession(stateFile, state, session, data) {
  const nextState = {
    ...state,
    sessions: {
      ...(state.sessions || {}),
      [session.id]: {
        mtimeMs: session.mtimeMs,
        processedAt: new Date().toISOString(),
        ...data,
      },
    },
  };
  writeJson(stateFile, nextState);
}

export function runSessionGitSync({
  rootDir = DEFAULT_ROOT_DIR,
  sessionsDir = DEFAULT_SESSIONS_DIR,
  apply = false,
  now = new Date(),
  inactiveMinutes = DEFAULT_INACTIVE_MINUTES,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
} = {}) {
  const file = statePath(rootDir);
  const state = readJson(file, { sessions: {} });
  const sessions = findProjectSessions({ rootDir, sessionsDir, now, lookbackDays });
  const selected = selectInactiveCandidate({ sessions, state, now, inactiveMinutes });
  if (selected.status !== 'candidate') return { ...selected, committed: false, pushed: false };

  const session = selected.latest;
  const changes = collectChangedFiles(rootDir);
  const blockers = changes
    .map((change) => ({ ...change, reason: unsafePathReason(change.path) }))
    .filter((change) => change.reason);

  if (changes.length === 0) {
    if (apply) markSession(file, state, session, { status: 'no-changes' });
    return {
      status: 'no-changes',
      message: '最新非活跃会话没有对应的 Git 变更。',
      session,
      committed: false,
      pushed: false,
    };
  }

  if (blockers.length > 0) {
    return {
      status: 'blocked',
      message: '检测到禁止自动提交的文件，已跳过提交和推送。',
      session,
      blockers,
      committed: false,
      pushed: false,
    };
  }

  const adsReview = analyzeAdsStateReview({ rootDir });
  if (adsReview.candidates.length > 0) {
    return {
      status: 'ads-review-required',
      message: '检测到 ADS 状态漂移候选，必须先由模型写总结、移动到正确目录，再提交。',
      session,
      adsReview,
      committed: false,
      pushed: false,
    };
  }

  const categories = categoriesForChanges(changes);
  const topic = inferTopic(session, categories);
  const bottleneck = inferBottleneck(rootDir, categories);
  const commitMessage = formatCommitMessage({ session, topic, categories, bottleneck });
  const branch = runGit(rootDir, ['branch', '--show-current']).stdout.trim();

  if (!branch) {
    return {
      status: 'blocked',
      message: '当前处于 detached HEAD，不能自动提交并推送。',
      session,
      committed: false,
      pushed: false,
    };
  }

  const pushable = ensureBranchCanPush(rootDir, branch);
  if (!pushable.ok) {
    return {
      status: 'blocked',
      message: pushable.message,
      session,
      committed: false,
      pushed: false,
    };
  }

  if (!apply) {
    return {
      status: 'dry-run',
      message: '找到可收口会话和 Git 变更；当前为 dry-run。',
      session,
      changes,
      categories,
      topic,
      bottleneck,
      branch,
      commitMessage,
      committed: false,
      pushed: false,
    };
  }

  const stagePaths = [...new Set(changes.map((change) => change.path))];
  runGit(rootDir, ['add', '--', ...stagePaths]);
  const staged = runGit(rootDir, ['diff', '--cached', '--quiet'], { allowFail: true });
  if (staged.status === 0) {
    markSession(file, state, session, { status: 'no-staged-diff' });
    return {
      status: 'no-staged-diff',
      message: '检测到变更但没有可提交的 staged diff。',
      session,
      committed: false,
      pushed: false,
    };
  }

  runGit(rootDir, [
    '-c',
    'user.name=Codex Session Sync',
    '-c',
    'user.email=codex-session-sync@local',
    'commit',
    '-m',
    commitMessage.subject,
    '-m',
    commitMessage.body,
  ]);

  const commit = runGit(rootDir, ['log', '-1', '--format=%H %s']).stdout.trim();
  runGit(rootDir, ['push', 'origin', branch]);

  markSession(file, state, session, { status: 'pushed', commit, pushed: true, branch });
  return {
    status: 'pushed',
    message: '已按非活跃会话提交并推送。',
    session,
    changes,
    categories,
    topic,
    bottleneck,
    branch,
    commit,
    committed: true,
    pushed: true,
  };
}

function listWorktreePaths(rootDir) {
  const result = runGit(rootDir, ['worktree', 'list', '--porcelain']);
  return result.stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);
}

export function runSessionGitSyncForWorktrees({
  rootDir = DEFAULT_ROOT_DIR,
  sessionsDir = DEFAULT_SESSIONS_DIR,
  apply = false,
  now = new Date(),
  inactiveMinutes = DEFAULT_INACTIVE_MINUTES,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
} = {}) {
  const worktrees = listWorktreePaths(rootDir);
  const results = worktrees.map((worktreePath) => ({
    worktreePath,
    result: runSessionGitSync({
      rootDir: worktreePath,
      sessionsDir,
      apply,
      now,
      inactiveMinutes,
      lookbackDays,
    }),
  }));

  const pushed = results.filter((item) => item.result.pushed);
  const blocked = results.filter((item) => item.result.status === 'blocked');

  return {
    status: pushed.length > 0 ? 'pushed' : blocked.length > 0 ? 'blocked' : 'checked',
    message: pushed.length > 0
      ? `已提交并推送 ${pushed.length} 个非活跃会话 worktree。`
      : blocked.length > 0
        ? `有 ${blocked.length} 个 worktree 被安全规则阻塞。`
        : '已检查所有 worktree，没有需要提交推送的非活跃会话。',
    worktreeCount: worktrees.length,
    pushedCount: pushed.length,
    blockedCount: blocked.length,
    results,
  };
}

function parseArgs(args) {
  const getNumber = (name, fallback) => {
    const prefix = `--${name}=`;
    const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
    return raw ? Number(raw) : fallback;
  };

  return {
    apply: args.includes('--apply'),
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
    allWorktrees: args.includes('--all-worktrees'),
    inactiveMinutes: getNumber('inactive-minutes', DEFAULT_INACTIVE_MINUTES),
    lookbackDays: getNumber('lookback-days', DEFAULT_LOOKBACK_DAYS),
  };
}

function printResult(result, json = false) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('# 会话 Git 同步');
  console.log('');
  console.log(`- 状态：${result.message}`);
  if (result.session?.id) {
    const sessionPath = normalizePath(relative(process.cwd(), result.session.path));
    console.log(`- 会话：${result.session.id}`);
    console.log(`- 会话文件：${sessionPath}`);
  }
  if (result.topic) console.log(`- 主题：${result.topic}`);
  if (result.bottleneck) console.log(`- 战略瓶颈进展：${result.bottleneck}`);
  if (result.commit) console.log(`- Commit：${result.commit}`);
  if (result.blockers) {
    console.log('- 阻塞文件：');
    result.blockers.forEach((item) => console.log(`  - ${item.path}：${item.reason}`));
  }
  if (result.results) {
    console.log(`- Worktree 数：${result.worktreeCount}`);
    console.log(`- 推送数：${result.pushedCount}`);
    console.log(`- 阻塞数：${result.blockedCount}`);
  }
}

function printHelp() {
  console.log(`
会话 Git 同步

使用方法:
  bun run session:git-sync
  bun run session:git-sync:push
  bun run session:git-sync:push -- --all-worktrees

原则:
  只处理当前仓库最新 Codex 会话；最新会话超过 30 分钟无更新后，才提交当前 Git 变更。
  --apply 会提交并立刻推送到 origin/current-branch；没有“只 commit 不 push”的模式。
  --all-worktrees 会扫描 git worktree list，让主仓库定时任务统一收口每个会话 worktree。
`);
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    try {
      const runner = options.allWorktrees ? runSessionGitSyncForWorktrees : runSessionGitSync;
      const result = runner({
        rootDir: process.cwd(),
        apply: options.apply,
        inactiveMinutes: options.inactiveMinutes,
        lookbackDays: options.lookbackDays,
      });
      printResult(result, options.json);
    } catch (error) {
      console.error(`会话 Git 同步失败：${error.message}`);
      process.exit(1);
    }
  }
}
