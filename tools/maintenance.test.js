import { describe, expect, test } from 'bun:test';

import { collectAutoFixes, maintenancePlan } from './maintenance.js';

describe('maintenance', () => {
  test('classifies maintenance commands by cadence', () => {
    expect(maintenancePlan('frequent').commands.map((item) => item.command)).toContain('bun run direction:sync:apply');
    expect(maintenancePlan('frequent').commands.map((item) => item.command)).toContain('bun run check --layer=ADS');
    expect(maintenancePlan('frequent').commands.map((item) => item.command)).toContain('bun run ads:review');
    expect(maintenancePlan('frequent').commands.map((item) => item.command)).toContain('bun run progress:hourly:apply');
    expect(maintenancePlan('frequent').commands.map((item) => item.command)).not.toContain('bun run session:git-sync:push');
    expect(maintenancePlan('frequent').commands.map((item) => item.command)).not.toContain('bun run jc -- --commit');
    expect(maintenancePlan('frequent').commands.map((item) => item.command)).toContain('bun run session:worktree:merge:apply');
    expect(maintenancePlan('daily').commands.map((item) => item.command)).not.toContain('bun run jp -- --aggregate --commit --push');
    expect(maintenancePlan('weekly').commands.map((item) => item.command)).toContain('bun run history:migrate');
    expect(maintenancePlan('weekly').commands.map((item) => item.command)).toContain('bun run hermes:skills:doctor');
    expect(maintenancePlan('manual').commands.map((item) => item.command)).toContain('bun run history:migrate:apply');
  });

  test('collects auto-fix suggestions from command output', () => {
    const fixes = collectAutoFixes('frequent', '最小下一步：运行 `bun run index` 刷新索引。');
    expect(fixes.map((fix) => fix.command)).toContain('bun run index');
  });
});
