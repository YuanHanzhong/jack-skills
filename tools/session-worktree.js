#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, statSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

const DEFAULT_SESSIONS_DIR = join(process.env.HOME || '/Users/jack', '.codex', 'sessions');

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

function parseSessionHeader(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.type === 'session_meta') {
      return {
        id: event.payload?.id,
        cwd: event.payload?.cwd,
        timestamp: event.payload?.timestamp || event.timestamp,
        path,
        mtimeMs: statSync(path).mtimeMs,
      };
    }
  }
  return null;
}

function latestSessionForRoot(rootDir, sessionsDir) {
  const root = canonicalPath(rootDir);
  return listJsonlFiles(sessionsDir)
    .map(parseSessionHeader)
    .filter((session) => session?.cwd && canonicalPath(session.cwd) === root)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

function slugSessionId(sessionId) {
  return (sessionId || 'manual-session').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 36);
}

function defaultWorktreeRoot(rootDir) {
  return join(dirname(rootDir), `${basename(rootDir)}-worktrees`);
}

export function planSessionWorktree({
  rootDir = process.cwd(),
  sessionsDir = DEFAULT_SESSIONS_DIR,
  sessionId = null,
  worktreeRoot = defaultWorktreeRoot(rootDir),
} = {}) {
  const root = resolve(rootDir);
  const session = sessionId
    ? { id: sessionId, cwd: root, path: null }
    : latestSessionForRoot(root, sessionsDir);

  if (!session?.id) {
    return {
      status: 'no-session',
      message: '没有找到当前仓库的 Codex 会话，不能生成会话 worktree。',
    };
  }

  const slug = slugSessionId(session.id);
  return {
    status: 'planned',
    session,
    branch: `codex/session-${slug}`,
    worktreePath: join(worktreeRoot, slug),
  };
}

export function ensureSessionWorktree(options = {}) {
  const plan = planSessionWorktree(options);
  if (plan.status !== 'planned') return plan;

  const rootDir = resolve(options.rootDir || process.cwd());
  const exists = existsSync(plan.worktreePath);
  if (!exists) {
    mkdirSync(dirname(plan.worktreePath), { recursive: true });
    const branchExists = runGit(rootDir, ['rev-parse', '--verify', plan.branch], { allowFail: true }).ok;
    const args = branchExists
      ? ['worktree', 'add', plan.worktreePath, plan.branch]
      : ['worktree', 'add', '-b', plan.branch, plan.worktreePath, 'HEAD'];
    runGit(rootDir, args);
  }

  return {
    ...plan,
    status: exists ? 'exists' : 'created',
    message: exists ? '会话 worktree 已存在。' : '已创建会话 worktree。',
  };
}

function parseWorktrees(rootDir) {
  const result = runGit(rootDir, ['worktree', 'list', '--porcelain']);
  const worktrees = [];
  let current = null;

  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length).trim(), branch: null };
    } else if (current && line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length).trim();
    }
  }

  if (current) worktrees.push(current);
  return worktrees;
}

function isCleanWorktree(path) {
  return runGit(path, ['status', '--porcelain']).stdout.trim() === '';
}

function localBranchCount(rootDir) {
  return runGit(rootDir, ['branch', '--format=%(refname:short)'])
    .stdout
    .split('\n')
    .filter(Boolean)
    .length;
}

export function mergeSessionWorktrees({
  rootDir = process.cwd(),
  apply = false,
  push = true,
} = {}) {
  const root = resolve(rootDir);
  const baseBranch = runGit(root, ['branch', '--show-current']).stdout.trim();
  if (!baseBranch) {
    return {
      status: 'blocked',
      message: '主工作区处于 detached HEAD，不能自动合并会话分支。',
      merged: [],
      skipped: [],
      branchCount: localBranchCount(root),
    };
  }

  if (!isCleanWorktree(root)) {
    return {
      status: 'blocked',
      message: '主工作区存在未提交变更，跳过自动合并，避免混入当前对话。',
      merged: [],
      skipped: [],
      branchCount: localBranchCount(root),
    };
  }

  if (apply && push) {
    const remote = runGit(root, ['remote', 'get-url', 'origin'], { allowFail: true });
    if (!remote.ok) {
      return {
        status: 'blocked',
        message: '没有配置 origin remote，不能保证合并后推送。',
        merged: [],
        skipped: [],
        branchCount: localBranchCount(root),
      };
    }
  }

  const sessionWorktrees = parseWorktrees(root)
    .filter((item) => item.branch?.startsWith('codex/session-') && item.path !== root);
  const merged = [];
  const skipped = [];

  for (const item of sessionWorktrees) {
    if (!isCleanWorktree(item.path)) {
      skipped.push({ ...item, reason: '会话 worktree 仍有未提交变更' });
      continue;
    }

    if (!apply) {
      skipped.push({ ...item, reason: 'dry-run' });
      continue;
    }

    const merge = runGit(root, ['merge', '--no-ff', '--no-edit', item.branch], { allowFail: true });
    if (!merge.ok) {
      runGit(root, ['merge', '--abort'], { allowFail: true });
      skipped.push({ ...item, reason: '自动合并有冲突，已保留分支和 worktree' });
      continue;
    }

    if (push) runGit(root, ['push', 'origin', baseBranch]);
    runGit(root, ['worktree', 'remove', item.path]);
    runGit(root, ['branch', '-d', item.branch]);
    if (push) runGit(root, ['push', 'origin', `:${item.branch}`], { allowFail: true });
    merged.push(item);
  }

  return {
    status: merged.length > 0 ? 'merged' : 'checked',
    message: merged.length > 0
      ? `已无冲突合并 ${merged.length} 个会话分支，并清理对应 worktree。`
      : '没有可自动合并的会话分支。',
    merged,
    skipped,
    branchCount: localBranchCount(root),
  };
}

function parseArgs(args) {
  const valueFor = (name) => {
    const prefix = `--${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || null;
  };

  return {
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
    apply: args.includes('--apply'),
    merge: args.includes('--merge'),
    sessionId: valueFor('session-id'),
    worktreeRoot: valueFor('worktree-root'),
  };
}

function printResult(result, json = false) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('# 会话 worktree');
  console.log('');
  console.log(`- 状态：${result.message || result.status}`);
  if (result.session?.id) console.log(`- 会话：${result.session.id}`);
  if (result.branch) console.log(`- 分支：${result.branch}`);
  if (result.worktreePath) console.log(`- Worktree：${normalizePath(result.worktreePath)}`);
  if (result.branchCount !== undefined) console.log(`- 本地分支数：${result.branchCount}`);
  if (result.merged) console.log(`- 已合并：${result.merged.length}`);
  if (result.skipped) console.log(`- 跳过：${result.skipped.length}`);
}

function printHelp() {
  console.log(`
会话 worktree

使用方法:
  bun run session:worktree
  bun run session:worktree -- --apply
  bun run session:worktree -- --merge --apply

原则:
  为当前仓库最新 Codex 会话创建独立 worktree 和 codex/session-* 分支。
  后续对话进入该 worktree 后，session:git-sync 会在对应 worktree 内提交并推送。
  --merge --apply 会把无冲突、干净的 codex/session-* worktree 合并回当前分支，推送后清理 worktree 和分支。
`);
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    try {
      const result = options.merge
        ? mergeSessionWorktrees({ rootDir: process.cwd(), apply: options.apply })
        : (options.apply ? ensureSessionWorktree : planSessionWorktree)({
          rootDir: process.cwd(),
          sessionId: options.sessionId,
          worktreeRoot: options.worktreeRoot || undefined,
        });
      printResult(result, options.json);
    } catch (error) {
      console.error(`会话 worktree 失败：${error.message}`);
      process.exit(1);
    }
  }
}
