import { describe, expect, test } from 'bun:test';

import {
  assessJob,
  classifyJob,
  renderScheduledJobIndex,
} from './scheduled-job-index.js';

describe('scheduled job index', () => {
  test('classifies common scheduled job families', () => {
    expect(classifyJob({ name: 'Jack 风扇早晨平衡模式', action: '' })).toBe('硬件控制');
    expect(classifyJob({ name: 'flclash-kimi-guardian', action: '' })).toBe('网络守护');
    expect(classifyJob({ name: '规则执行健康巡检', action: 'bun run rules:health' })).toBe('配置审计');
  });

  test('flags unattended gateway restart jobs as unreasonable', () => {
    const assessment = assessJob({
      enabled: true,
      state: 'scheduled',
      name: '凌晨5点重启所有飞书Gateway + 配置审计',
      action: 'script: restart-all-gateways.sh',
      schedule: '0 5 * * *',
      lastStatus: 'ok',
    });

    expect(assessment).toContain('无人值守重启 gateway');
  });

  test('renders a stable markdown table', () => {
    const markdown = renderScheduledJobIndex([
      {
        source: 'Hermes cron',
        owner: 'explorer',
        name: 'Hermes cron 配置自审计',
        schedule: '15 5 * * *',
        enabled: true,
        state: 'scheduled',
        lastStatus: 'ok',
        action: 'script: hermes-cron-config-audit.py',
        authority: '/Users/jack/.hermes/profiles/explorer/cron/jobs.json',
      },
    ]);

    expect(markdown).toContain('# 自动化与定时任务索引');
    expect(markdown).toContain('Hermes cron 配置自审计');
    expect(markdown).toContain('生成命令');
  });
});
