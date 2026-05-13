import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, test } from 'bun:test';
import {
  buildMemoryBlock,
  bridgeSync,
  extractBridgeSummary,
  findOldReferences,
  upsertBlock,
} from './bridge-sync.js';

const AGENTS_SAMPLE = `# Router

## 🧭 最高编码准则

Keep it small.

## 🧷 唯一真实来源原则

同一规则只能有一个权威来源。

## 🚦 启动模式

L0.

## 🧩 Hermes 技能路由

Hermes 技能的唯一真实来源是 /Users/jack/.hermes/skills。

## 🚫 硬性禁止

No.
`;

describe('bridge sync helpers', () => {
  test('extracts only bridge-related AGENTS sections', () => {
    const summary = extractBridgeSummary(AGENTS_SAMPLE);

    expect(summary).toContain('## 🧷 唯一真实来源原则');
    expect(summary).toContain('## 🧩 Hermes 技能路由');
    expect(summary).toContain('同一规则只能有一个权威来源');
    expect(summary).not.toContain('## 🚦 启动模式');
    expect(summary).not.toContain('## 🚫 硬性禁止');
  });

  test('builds a replaceable profile memory block', () => {
    const root = mkdtempSync(join(tmpdir(), 'bridge-sync-test-'));
    const agentsPath = join(root, 'AGENTS.md');
    writeFileSync(agentsPath, AGENTS_SAMPLE, 'utf8');

    const block = buildMemoryBlock({
      agentsPath,
      generatedAt: new Date('2026-05-09T00:00:00Z'),
    });

    expect(block).toContain('CODEX_HERMES_BRIDGE_SYNC:START');
    expect(block).toContain(`source: ${agentsPath}`);
    expect(block).toContain('updated: 2026-05-09T00:00:00.000Z');
    expect(block).toContain('同一规则只能有一个权威来源');
    expect(block).toContain('Hermes 技能的唯一真实来源');
    expect(block).toContain('不是第二份规则正文');
  });

  test('upserts the bridge block without duplicating it', () => {
    const first = upsertBlock('existing memory\n', 'BLOCK1');
    const withMarkers = upsertBlock(
      `before\n\n<!-- CODEX_HERMES_BRIDGE_SYNC:START -->\nold\n<!-- CODEX_HERMES_BRIDGE_SYNC:END -->\n\nafter\n`,
      `<!-- CODEX_HERMES_BRIDGE_SYNC:START -->\nnew\n<!-- CODEX_HERMES_BRIDGE_SYNC:END -->`,
    );

    expect(first).toContain('existing memory');
    expect(first).toContain('BLOCK1');
    expect(withMarkers).toContain('before');
    expect(withMarkers).toContain('new');
    expect(withMarkers).toContain('after');
    expect(withMarkers).not.toContain('old');
  });

  test('upsert is stable when existing text follows the bridge block', () => {
    const block = `<!-- CODEX_HERMES_BRIDGE_SYNC:START -->\nnew\n<!-- CODEX_HERMES_BRIDGE_SYNC:END -->`;
    const existing = `before\n\n${block}\n\nafter\n\n\n`;

    const once = upsertBlock(existing, block);
    const twice = upsertBlock(once, block);

    expect(twice).toBe(once);
  });

  test('reports old references in configured roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'bridge-sync-old-ref-test-'));
    const filePath = join(root, 'rule.md');
    writeFileSync(filePath, 'legacy jack-fan-control reference\n', 'utf8');

    const refs = findOldReferences({
      roots: [root],
      patterns: ['jack-fan-control'],
    });

    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe(filePath);
    expect(refs[0].line).toBe(1);
  });

  test('uses AGENTS mtime for repeatable memory blocks by default', () => {
    const root = mkdtempSync(join(tmpdir(), 'bridge-sync-repeat-test-'));
    const agentsPath = join(root, 'AGENTS.md');
    const profilesRoot = join(root, 'profiles');
    const skillsRoot = join(root, 'skills');
    const skillDir = join(skillsRoot, 'apple', 'jack-computer-control');
    const manifestPath = join(root, 'manifest.json');
    const profileDir = join(profilesRoot, 'default');
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(agentsPath, AGENTS_SAMPLE, 'utf8');
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: jack-computer-control
description: Control local computer settings.
---

# Jack Computer Control
`,
      'utf8',
    );

    const first = bridgeSync({
      agentsPath,
      profilesRoot,
      skillsRoot,
      manifestPath,
      memoryProfiles: ['default'],
      verifyProfiles: [],
      oldRefPatterns: [],
    });
    const second = bridgeSync({
      agentsPath,
      profilesRoot,
      skillsRoot,
      manifestPath,
      memoryProfiles: ['default'],
      verifyProfiles: [],
      oldRefPatterns: [],
    });

    expect(first.memoryResults[0].status).toBe('updated');
    expect(second.memoryResults[0].status).toBe('unchanged');
    expect(first.reloadRecommended).toEqual(['default']);
    expect(second.reloadRecommended).toEqual([]);
  });

  test('discovers direct profile directories for memory sync by default', () => {
    const root = mkdtempSync(join(tmpdir(), 'bridge-sync-profile-discovery-test-'));
    const agentsPath = join(root, 'AGENTS.md');
    const profilesRoot = join(root, 'profiles');
    mkdirSync(join(profilesRoot, 'alpha'), { recursive: true });
    mkdirSync(join(profilesRoot, '中文'), { recursive: true });
    writeFileSync(agentsPath, AGENTS_SAMPLE, 'utf8');

    const result = bridgeSync({
      dryRun: true,
      agentsPath,
      profilesRoot,
      verifyProfiles: [],
      oldRefPatterns: [],
    });

    expect(result.memoryResults.map((item) => item.profile).sort()).toEqual(['alpha', '中文'].sort());
  });
});
