import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  discoverProjectConfig,
  formatConfigDiscoveryReport,
  formatToolCatalog,
} from './config-discovery.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-config-discovery-'));
  mkdirSync(join(root, 'tools'), { recursive: true });
  mkdirSync(join(root, '00_DIM', 'rules'), { recursive: true });

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          'knowledge:health': 'bun run tools/knowledge-health.js --fail-on-issues',
          'memory:search': 'bun tools/vec-search.js',
          'direction:sync:apply': 'bun run tools/direction-sync.js --apply',
        },
      },
      null,
      2
    )
  );

  writeFileSync(
    join(root, 'tools', 'sample.js'),
    [
      'const apiKey = process.env.DASHSCOPE_API_KEY;',
      'const hooks = process.env.KMS_ENABLE_MEMORY_HOOKS || "0";',
      'const mode = process.env.KMS_MODE ?? "light";',
      'const token = process.env.GITHUB_TOKEN;',
      'console.log(apiKey, hooks, mode, token);',
    ].join('\n')
  );

  writeFileSync(
    join(root, '00_DIM', 'rules', '示例规范.md'),
    [
      '# 示例规范',
      '',
      '- 使用 `KMS_ENABLE_MEMORY_SAVE=1` 开启保存。',
      '- `DASHSCOPE_API_KEY` 是敏感配置。',
    ].join('\n')
  );

  return root;
}

describe('config-discovery', () => {
  test('discovers package scripts and configuration keys', async () => {
    const report = await discoverProjectConfig({ rootDir: makeFixture() });

    expect(report.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'bun run knowledge:health',
          scriptPath: 'tools/knowledge-health.js',
          risk: 'medium',
        }),
        expect.objectContaining({
          command: 'bun run direction:sync:apply',
          scriptPath: 'tools/direction-sync.js',
          risk: 'medium',
        }),
      ])
    );

    expect(report.configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'DASHSCOPE_API_KEY',
          sensitive: true,
          required: true,
        }),
        expect.objectContaining({
          key: 'KMS_ENABLE_MEMORY_HOOKS',
          sensitive: false,
          defaultValue: '0',
        }),
        expect.objectContaining({
          key: 'KMS_MODE',
          sensitive: false,
          defaultValue: 'light',
        }),
      ])
    );
  });

  test('formats markdown reports for quick new-window discovery', async () => {
    const report = await discoverProjectConfig({ rootDir: makeFixture() });
    const configMarkdown = formatConfigDiscoveryReport(report);
    const catalogMarkdown = formatToolCatalog(report);

    expect(configMarkdown).toContain('# 配置发现报告');
    expect(configMarkdown).toContain('DASHSCOPE_API_KEY');
    expect(configMarkdown).toContain('bun run knowledge:health');
    expect(catalogMarkdown).toContain('# 工具能力目录');
    expect(catalogMarkdown).toContain('| `bun run direction:sync:apply` |');
    expect(catalogMarkdown).toContain('00_DIM / 04_ADS / tools');
  });

  test('ignores environment-like text inside regex literals', async () => {
    const root = makeFixture();
    writeFileSync(
      join(root, 'tools', 'regex.js'),
      'const donePattern = /ALL_OK=true|3 pass\\/0 fail/;',
    );

    const report = await discoverProjectConfig({ rootDir: root });

    expect(report.configs.map((config) => config.key)).not.toContain('ALL_OK');
  });
});
