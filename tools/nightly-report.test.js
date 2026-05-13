import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runNightlyReport, writeNightlyReport } from './nightly-report.js';

describe('nightly-report', () => {
  test('persists a DWS daily maintenance report', () => {
    const root = mkdtempSync(join(tmpdir(), 'kms-nightly-report-'));
    mkdirSync(join(root, '03_DWS', 'sessions'), { recursive: true });

    const result = writeNightlyReport({
      rootDir: root,
      now: new Date('2026-05-08T02:00:00+08:00'),
      sections: [
        { title: '方向盘同步', command: 'bun run direction:sync', output: '已对齐', ok: true },
      ],
    });

    expect(result.path).toContain('03_DWS/sessions/知识库日报/26-0508-02-知识库夜间整理报告.md');
    expect(existsSync(join(root, result.path))).toBe(true);
    const content = readFileSync(join(root, result.path), 'utf8');
    expect(content).toContain('canonical_id: nightly-maintenance-2026-05-08-02');
    expect(content).toContain('## 当前结论');
    expect(content).toContain('## 精确时间线');
    expect(content).toContain('已对齐');
    expect(readdirSync(join(root, '03_DWS', 'sessions', '知识库日报'))).toHaveLength(1);
  });

  test('daily report plan includes broad checks and protected reload candidate scan', () => {
    const calls = [];
    const root = mkdtempSync(join(tmpdir(), 'kms-nightly-plan-'));

    const result = runNightlyReport({
      rootDir: root,
      now: new Date('2026-05-08T04:00:00+08:00'),
      commands: [
        'bun run maintenance:frequent:apply',
        'bun run state:maintain:apply',
        'bun run nightly:restart',
      ],
      retryDelayMs: 0,
      runCommandFn: (_rootDir, command) => {
        calls.push(command);
        return { title: command, command, output: `${command} ok`, ok: true };
      },
    });

    expect(calls).toEqual([
      'bun run maintenance:frequent:apply',
      'bun run state:maintain:apply',
      'bun run nightly:restart',
    ]);
    expect(result.path).toContain('26-0508-04-知识库夜间整理报告.md');
  });

  test('retries failed commands up to five attempts before reporting failure', () => {
    const calls = [];
    const root = mkdtempSync(join(tmpdir(), 'kms-nightly-retry-'));

    const result = runNightlyReport({
      rootDir: root,
      now: new Date('2026-05-08T04:00:00+08:00'),
      commands: ['gbrain stats'],
      retryDelayMs: 0,
      maxAttempts: 5,
      runCommandFn: (_rootDir, command) => {
        calls.push(command);
        return { title: command, command, output: `failed ${calls.length}`, ok: false };
      },
    });

    expect(calls).toHaveLength(5);
    expect(result.failed).toBe(1);
    const content = readFileSync(join(root, result.path), 'utf8');
    expect(content).toContain('尝试次数：5/5');
    expect(content).toContain('failed 5');
  });

  test('stops retrying after a command succeeds', () => {
    const calls = [];
    const root = mkdtempSync(join(tmpdir(), 'kms-nightly-retry-success-'));

    const result = runNightlyReport({
      rootDir: root,
      now: new Date('2026-05-08T04:00:00+08:00'),
      commands: ['gbrain stats'],
      retryDelayMs: 0,
      maxAttempts: 5,
      runCommandFn: (_rootDir, command) => {
        calls.push(command);
        return { title: command, command, output: calls.length < 3 ? `failed ${calls.length}` : 'ok on third attempt', ok: calls.length >= 3 };
      },
    });

    expect(calls).toHaveLength(3);
    expect(result.failed).toBe(0);
    const content = readFileSync(join(root, result.path), 'utf8');
    expect(content).toContain('尝试次数：3/5');
    expect(content).toContain('ok on third attempt');
  });
});
