import { describe, expect, test } from 'bun:test';

import {
  analyzeCodexAutomations,
  analyzeLaunchAgents,
  analyzeMaintenancePlan,
} from './automation-audit.js';

describe('automation audit', () => {
  test('flags an active DWS hourly progress log automation', () => {
    const issues = analyzeCodexAutomations([
      {
        id: 'auto',
        name: 'auto_知识库小时进展日志',
        status: 'ACTIVE',
        prompt: 'run bun run progress:hourly:apply and write 03_DWS/insights/YYYY-MM-DD-hourly-progress.md',
      },
    ]);

    expect(issues.map((issue) => issue.id)).toContain('codex-hourly-progress-log-active');
  });

  test('allows paused historical hourly progress automation', () => {
    const issues = analyzeCodexAutomations([
      {
        id: 'auto',
        name: 'auto_知识库小时进展日志_已暂停',
        status: 'PAUSED',
        prompt: '已暂停；进展查看以 git log 为准。',
      },
    ]);

    expect(issues).toEqual([]);
  });

  test('allows frequent maintenance to commit changed files without push', () => {
    const issues = analyzeMaintenancePlan({
      commands: [
        { command: 'bun run direction:watchdog' },
        { command: 'bun run progress:hourly:apply' },
      ],
    });

    expect(issues).toEqual([]);
  });

  test('flags frequent maintenance when it runs automatic closeout or push work', () => {
    const issues = analyzeMaintenancePlan({
      commands: [
        { command: 'bun run direction:watchdog' },
        { command: 'bun run session:git-sync:push' },
        { command: 'bun run jp -- --aggregate --commit --push' },
      ],
    });

    expect(issues.map((issue) => issue.id)).toEqual([
      'frequent-maintenance-rereads-session-transcript',
      'frequent-maintenance-runs-jp-push',
    ]);
  });

  test('flags launchd gbrain schedules that are too frequent or collide with daily maintenance', () => {
    const issues = analyzeLaunchAgents({
      'com.gbrain.jack.maintain': { StartInterval: 900, RunAtLoad: true },
      'com.gbrain.jack.dream': { StartCalendarInterval: { Hour: 4, Minute: 0 } },
    });

    expect(issues.map((issue) => issue.id)).toEqual([
      'gbrain-maintain-too-frequent',
      'gbrain-maintain-run-at-load',
      'gbrain-dream-collides-with-daily',
    ]);
  });
});
