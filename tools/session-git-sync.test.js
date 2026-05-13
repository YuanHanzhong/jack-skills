import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

import { runSessionGitSync, runSessionGitSyncForWorktrees } from './session-git-sync.js';

function git(rootDir, args) {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout;
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'session-git-sync-repo-'));
  git(root, ['init']);
  mkdirSync(join(root, '00_方向盘'), { recursive: true });
  writeFileSync(
    join(root, '00_方向盘', '03_战略瓶颈.md'),
    '# 战略瓶颈\n\n## 当前瓶颈\n\n让执行层进展持续有痕。\n',
    'utf8',
  );
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'test: initial',
  ]);
  return root;
}

function addBareRemote(root) {
  const remote = mkdtempSync(join(tmpdir(), 'session-git-sync-remote-'));
  git(remote, ['init', '--bare']);
  git(root, ['remote', 'add', 'origin', remote]);
  const branch = git(root, ['branch', '--show-current']).trim();
  git(root, ['push', 'origin', branch]);
  return remote;
}

function writeSession(sessionsDir, { id, rootDir, timestamp, userMessage }) {
  const dayDir = join(sessionsDir, '2026', '05', '09');
  mkdirSync(dayDir, { recursive: true });
  const path = join(dayDir, `rollout-2026-05-09T00-00-00-${id}.jsonl`);
  const content = [
    JSON.stringify({
      timestamp,
      type: 'session_meta',
      payload: { id, cwd: rootDir, timestamp },
    }),
    JSON.stringify({
      timestamp,
      type: 'event_msg',
      payload: { type: 'user_message', message: userMessage },
    }),
  ].join('\n');
  writeFileSync(path, `${content}\n`, 'utf8');
  const time = new Date(timestamp);
  utimesSync(path, time, time);
  return path;
}

describe('session git sync', () => {
  test('does not commit while the latest project session is still active', () => {
    const root = makeRepo();
    const sessionsDir = mkdtempSync(join(tmpdir(), 'session-git-sync-sessions-'));
    const now = new Date('2026-05-09T10:00:00+08:00');

    writeSession(sessionsDir, {
      id: 'old-session',
      rootDir: root,
      timestamp: '2026-05-09T01:00:00.000Z',
      userMessage: '旧会话应当已经不活跃',
    });
    writeSession(sessionsDir, {
      id: 'active-session',
      rootDir: root,
      timestamp: '2026-05-09T01:45:00.000Z',
      userMessage: '最新会话还在继续',
    });

    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'demo.js'), 'console.log("demo");\n', 'utf8');

    const result = runSessionGitSync({ rootDir: root, sessionsDir, apply: true, now });

    expect(result.status).toBe('latest-active');
    expect(result.committed).toBe(false);
    expect(git(root, ['status', '--short', '--untracked-files=all'])).toContain('tools/demo.js');
  });

  test('commits an inactive session with public reasoning and bottleneck notes', () => {
    const root = makeRepo();
    addBareRemote(root);
    const sessionsDir = mkdtempSync(join(tmpdir(), 'session-git-sync-sessions-'));
    const now = new Date('2026-05-09T10:00:00+08:00');

    writeSession(sessionsDir, {
      id: 'inactive-session',
      rootDir: root,
      timestamp: '2026-05-09T01:00:00.000Z',
      userMessage: '优化 GitHub 提交，按照一个对话一个主题收口',
    });

    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'demo.js'), 'console.log("demo");\n', 'utf8');

    const result = runSessionGitSync({ rootDir: root, sessionsDir, apply: true, now });

    expect(result.status).toBe('pushed');
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);

    const commit = git(root, ['log', '-1', '--format=%s%n%b']);
    expect(commit).toContain('chore: 优化 GitHub 提交');
    expect(commit).toContain('战略瓶颈进展');
    expect(commit).toContain('公开推理摘要');
    expect(commit).toContain('tools/demo.js');
    expect(git(root, ['status', '--short']).trim()).toBe('');

    const state = readFileSync(join(root, '.git', 'codex-session-git-sync-state.json'), 'utf8');
    expect(state).toContain('inactive-session');
  });

  test('blocks before commit when the remote branch is ahead', () => {
    const root = makeRepo();
    const remote = addBareRemote(root);
    const clone = mkdtempSync(join(tmpdir(), 'session-git-sync-clone-'));
    git(clone, ['clone', remote, '.']);
    writeFileSync(join(clone, 'remote.md'), 'remote change\n', 'utf8');
    git(clone, ['add', 'remote.md']);
    git(clone, [
      '-c',
      'user.name=Remote',
      '-c',
      'user.email=remote@example.com',
      'commit',
      '-m',
      'test: remote advance',
    ]);
    const branch = git(clone, ['branch', '--show-current']).trim();
    git(clone, ['push', 'origin', branch]);

    const sessionsDir = mkdtempSync(join(tmpdir(), 'session-git-sync-sessions-'));
    const now = new Date('2026-05-09T10:00:00+08:00');
    writeSession(sessionsDir, {
      id: 'remote-ahead-session',
      rootDir: root,
      timestamp: '2026-05-09T01:00:00.000Z',
      userMessage: '远端领先时不要先制造本地 commit',
    });
    writeFileSync(join(root, 'local.md'), 'local change\n', 'utf8');

    const before = git(root, ['rev-parse', 'HEAD']).trim();
    const result = runSessionGitSync({ rootDir: root, sessionsDir, apply: true, now });

    expect(result.status).toBe('blocked');
    expect(result.message).toContain('领先本地');
    expect(git(root, ['rev-parse', 'HEAD']).trim()).toBe(before);
    expect(git(root, ['status', '--short'])).toContain('local.md');
  });

  test('blocks commit when ADS review finds state drift candidates', () => {
    const root = makeRepo();
    const sessionRoot = mkdtempSync(join(tmpdir(), 'session-git-sync-sessions-'));
    writeSession(sessionRoot, {
      id: 'session-ads',
      rootDir: root,
      timestamp: '2026-05-09T01:00:00.000Z',
      userMessage: '整理 ADS',
    });
    mkdirSync(join(root, '04_ADS', '2_进行中'), { recursive: true });
    writeFileSync(
      join(root, '04_ADS', '2_进行中', '26-0509-02-exec-task_plan-done.md'),
      [
        '---',
        'status: in_progress',
        '---',
        '',
        '# Done',
        '',
        '- [x] 完成实现。',
        '- [x] 完成验证。',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(root, '04_ADS', '2_进行中', '26-0509-02-exec-progress-done.md'),
      '最终验证：bun test 1 pass/0 fail。\n任务状态：本任务可以归档到 `3_已完成/`。\n',
      'utf8',
    );
    writeFileSync(
      join(root, '04_ADS', '2_进行中', '26-0509-02-exec-findings-done.md'),
      '发现已完成。\n',
      'utf8',
    );

    const result = runSessionGitSync({
      rootDir: root,
      sessionsDir: sessionRoot,
      apply: true,
      now: new Date('2026-05-09T02:00:00.000Z'),
    });

    expect(result.status).toBe('ads-review-required');
    expect(result.committed).toBe(false);
    expect(result.adsReview.candidates).toHaveLength(1);
  });

  test('scans all git worktrees and pushes inactive session branches', () => {
    const root = makeRepo();
    addBareRemote(root);
    const sessionsDir = mkdtempSync(join(tmpdir(), 'session-git-sync-sessions-'));
    const worktreePath = join(mkdtempSync(join(tmpdir(), 'session-git-sync-worktree-')), 'wt');
    const branch = 'codex/session-inactive-worktree';
    git(root, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);
    git(worktreePath, ['push', 'origin', branch]);
    const now = new Date('2026-05-09T10:00:00+08:00');

    writeSession(sessionsDir, {
      id: 'inactive-worktree',
      rootDir: worktreePath,
      timestamp: '2026-05-09T01:00:00.000Z',
      userMessage: 'worktree 会话独立提交并推送',
    });
    mkdirSync(join(worktreePath, 'tools'), { recursive: true });
    writeFileSync(join(worktreePath, 'tools', 'worktree-demo.js'), 'console.log("worktree");\n', 'utf8');

    const result = runSessionGitSyncForWorktrees({ rootDir: root, sessionsDir, apply: true, now });

    expect(result.status).toBe('pushed');
    expect(result.pushedCount).toBe(1);
    expect(result.results.some((item) => item.result.pushed)).toBe(true);
    expect(git(worktreePath, ['status', '--short']).trim()).toBe('');
  });
});
