import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

import { runHourlyProgress, unsafePathReason } from './hourly-progress.js';

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
  const root = mkdtempSync(join(tmpdir(), 'hourly-progress-'));
  git(root, ['init']);
  mkdirSync(join(root, '00_方向盘'), { recursive: true });
  writeFileSync(
    join(root, '00_方向盘', '03_战略瓶颈.md'),
    '# 战略瓶颈\n\n- 让执行层进展持续有痕。\n',
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

describe('hourly progress', () => {
  test('does nothing when the worktree is clean', () => {
    const root = makeRepo();
    const result = runHourlyProgress({ rootDir: root, apply: true });

    expect(result.hadChanges).toBe(false);
    expect(result.committed).toBe(false);
  });

  test('blocks automatic commits for protected paths', () => {
    const root = makeRepo();
    mkdirSync(join(root, '01_ODS'), { recursive: true });
    writeFileSync(join(root, '01_ODS', 'raw.md'), 'raw material\n', 'utf8');

    const result = runHourlyProgress({ rootDir: root, apply: true });

    expect(result.blocked).toBe(true);
    expect(result.blockers[0].reason).toContain('01_ODS');
  });

  test('commits changed files without writing a DWS hourly log', () => {
    const root = makeRepo();
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'demo.js'), 'console.log("demo");\n', 'utf8');

    const now = new Date('2026-05-09T01:30:00+08:00');
    const result = runHourlyProgress({ rootDir: root, apply: true, now });

    expect(result.committed).toBe(true);
    expect(result.reportPath).toBeUndefined();
    expect(spawnSync('test', ['!', '-e', join(root, '03_DWS')]).status).toBe(0);

    const commit = git(root, ['log', '-1', '--format=%s%n%b']);
    expect(commit).toContain('chore: 工具自动化');
    expect(commit).toContain('主题：工具自动化');
    expect(commit).toContain('解决的问题');
    expect(commit).toContain('推进的战略瓶颈');
    expect(commit).toContain('按主题分组的变更文件');
    expect(commit).toContain('tools/demo.js');
    expect(commit).not.toContain('小时日志');
  });

  test('flags sensitive paths', () => {
    expect(unsafePathReason('.env')).toContain('.env');
    expect(unsafePathReason('config/secrets.json')).toContain('密钥');
    expect(unsafePathReason('tools/demo.js')).toBe(null);
  });
});
