import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { formatNightlyRestartReport, runNightlyRestart } from './nightly-restart.js';

describe('nightly restart', () => {
  test('skips gateway restarts by default even in dry-run mode', () => {
    const result = runNightlyRestart({
      dryRun: true,
      domain: 'gui/501',
      labels: [
        { label: 'ai.hermes.gateway', reason: '主 gateway', statePath: '/tmp/missing-gateway-state.json' },
        { label: 'ai.hermes.gateway.navigator', reason: '方向盘 gateway', statePath: '/tmp/missing-navigator-state.json' },
      ],
    });

    expect(result.failed).toBe(0);
    expect(result.restarted).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.results[0].output).toContain('requires Jack explicit same-turn authorization');

    const report = formatNightlyRestartReport(result);
    expect(report).toContain('夜间服务重启');
    expect(report).toContain('ai.hermes.gateway.navigator');
  });

  test('plans gateway restart only when explicitly authorized', () => {
    const result = runNightlyRestart({
      dryRun: true,
      allowGatewayRestart: true,
      domain: 'gui/501',
      labels: [
        { label: 'ai.hermes.gateway', reason: '主 gateway' },
        { label: 'ai.hermes.gateway.navigator', reason: '方向盘 gateway' },
      ],
    });

    expect(result.failed).toBe(0);
    expect(result.restarted).toBe(2);
    expect(result.results[0].output).toContain('launchctl kickstart -k gui/501/ai.hermes.gateway');
  });

  test('skips authorized restart when no restart-relevant files changed', () => {
    const result = runNightlyRestart({
      dryRun: true,
      allowGatewayRestart: true,
      domain: 'gui/501',
      labels: [{ label: 'com.cc-connect.service', reason: 'cc-connect daemon', changed: false }],
    });

    expect(result.failed).toBe(0);
    expect(result.restarted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.protected).toBe(1);
    expect(result.results[0].output).toContain('no restart-relevant changes detected');
  });

  test('includes cc-connect gateway when explicitly authorized and changed', () => {
    const result = runNightlyRestart({
      dryRun: true,
      allowGatewayRestart: true,
      domain: 'gui/501',
      labels: [{ label: 'com.cc-connect.service', reason: 'cc-connect gateway', changed: true, modelInfo: 'agent=kimi，cmd=kimi' }],
    });

    expect(result.failed).toBe(0);
    expect(result.restarted).toBe(1);
    expect(result.results[0].output).toContain('launchctl kickstart -k gui/501/com.cc-connect.service');
    expect(result.results[0].output).toContain('agent=kimi');
  });

  test('skips adjacent watchdog restarts by default', () => {
    const result = runNightlyRestart({
      dryRun: true,
      domain: 'gui/501',
      labels: [
        { label: 'ai.hermes.gateway.watchdog', reason: 'gateway watchdog' },
        { label: 'ai.hermes.webui.watchdog', reason: 'webui watchdog' },
      ],
    });

    expect(result.restarted).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.protected).toBe(2);
    expect(result.results[0].output).toContain('service restart requires Jack explicit same-turn authorization');
  });

  test('skips gateway restart when active agents exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'kms-nightly-restart-'));
    const statePath = join(root, 'gateway_state.json');
    writeFileSync(statePath, JSON.stringify({ active_agents: 1 }), 'utf8');

    const result = runNightlyRestart({
      dryRun: true,
      allowGatewayRestart: true,
      domain: 'gui/501',
      labels: [{ label: 'ai.hermes.gateway', reason: '主 gateway', statePath }],
    });

    expect(result.restarted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.protected).toBe(1);
    expect(result.results[0].output).toContain('active_agents=1');
  });
});
