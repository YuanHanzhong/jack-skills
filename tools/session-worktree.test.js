import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

import { ensureSessionWorktree, mergeSessionWorktrees, planSessionWorktree } from './session-worktree.js';

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
  const root = mkdtempSync(join(tmpdir(), 'session-worktree-repo-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'user.email', 'test@example.com']);
  writeFileSync(join(root, 'README.md'), '# test\n', 'utf8');
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
  const remote = mkdtempSync(join(tmpdir(), 'session-worktree-remote-'));
  git(remote, ['init', '--bare']);
  git(root, ['remote', 'add', 'origin', remote]);
  const branch = git(root, ['branch', '--show-current']).trim();
  git(root, ['push', 'origin', branch]);
  return remote;
}

function writeSession(sessionsDir, { id, rootDir, timestamp }) {
  const dayDir = join(sessionsDir, '2026', '05', '09');
  mkdirSync(dayDir, { recursive: true });
  const path = join(dayDir, `rollout-${id}.jsonl`);
  writeFileSync(
    path,
    `${JSON.stringify({
      timestamp,
      type: 'session_meta',
      payload: { id, cwd: rootDir, timestamp },
    })}\n`,
    'utf8',
  );
}

describe('session worktree', () => {
  test('plans a branch and worktree path for the latest session', () => {
    const root = makeRepo();
    const sessionsDir = mkdtempSync(join(tmpdir(), 'session-worktree-sessions-'));
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'session-worktree-targets-'));
    writeSession(sessionsDir, {
      id: '019e0a4d-4466-73f0-8f28-694e1afeed3e',
      rootDir: root,
      timestamp: '2026-05-09T01:00:00.000Z',
    });

    const result = planSessionWorktree({ rootDir: root, sessionsDir, worktreeRoot });

    expect(result.status).toBe('planned');
    expect(result.branch).toContain('codex/session-019e0a4d');
    expect(result.worktreePath).toContain('019e0a4d');
  });

  test('creates an isolated git worktree and session branch', () => {
    const root = makeRepo();
    const sessionsDir = mkdtempSync(join(tmpdir(), 'session-worktree-sessions-'));
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'session-worktree-targets-'));
    writeSession(sessionsDir, {
      id: '019e0a4d-4466-73f0-8f28-694e1afeed3e',
      rootDir: root,
      timestamp: '2026-05-09T01:00:00.000Z',
    });

    const result = ensureSessionWorktree({ rootDir: root, sessionsDir, worktreeRoot });

    expect(result.status).toBe('created');
    expect(git(result.worktreePath, ['branch', '--show-current']).trim()).toBe(result.branch);
    expect(git(root, ['worktree', 'list'])).toContain(result.worktreePath);
  });

  test('merges clean session worktree branches and removes them', () => {
    const root = makeRepo();
    addBareRemote(root);
    const sessionsDir = mkdtempSync(join(tmpdir(), 'session-worktree-sessions-'));
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'session-worktree-targets-'));
    writeSession(sessionsDir, {
      id: '019e0a4d-4466-73f0-8f28-694e1afeed3e',
      rootDir: root,
      timestamp: '2026-05-09T01:00:00.000Z',
    });
    const worktree = ensureSessionWorktree({ rootDir: root, sessionsDir, worktreeRoot });

    writeFileSync(join(worktree.worktreePath, 'session.md'), 'session work\n', 'utf8');
    git(worktree.worktreePath, ['add', 'session.md']);
    git(worktree.worktreePath, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'test: session work',
    ]);
    git(worktree.worktreePath, ['push', 'origin', worktree.branch]);

    const result = mergeSessionWorktrees({ rootDir: root, apply: true });

    expect(result.status).toBe('merged');
    expect(result.merged.map((item) => item.branch)).toContain(worktree.branch);
    expect(git(root, ['worktree', 'list'])).not.toContain(worktree.worktreePath);
    expect(git(root, ['branch', '--format=%(refname:short)'])).not.toContain(worktree.branch);
    expect(git(root, ['log', '--oneline', '-5'])).toContain('test: session work');
  });
});
