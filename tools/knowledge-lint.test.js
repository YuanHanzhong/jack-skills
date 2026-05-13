import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { formatLintSuggestions, runKnowledgeLint } from './knowledge-lint.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-knowledge-lint-'));
  mkdirSync(join(root, '01_ODS', 'fromArticle'), { recursive: true });
  mkdirSync(join(root, '02_DWD', 'fromArticle'), { recursive: true });
  mkdirSync(join(root, '03_DWS', 'topics'), { recursive: true });
  mkdirSync(join(root, '04_ADS', '2_进行中'), { recursive: true });

  writeFileSync(
    join(root, '01_ODS', 'fromArticle', 'missing-hash.md'),
    ['---', 'title: Missing Hash', '---', '# Missing Hash', '', 'raw body'].join('\n')
  );
  writeFileSync(
    join(root, '02_DWD', 'fromArticle', 'missing-quality.md'),
    ['---', 'title: Missing Quality', '---', '# Missing Quality', '', '[[missing-target]]'].join('\n')
  );
  writeFileSync(join(root, '04_ADS', '2_进行中', '26-0508-12-plan-task_plan-incomplete.md'), '# Incomplete\n');

  return root;
}

describe('knowledge-lint', () => {
  test('returns fix suggestions without editing files', async () => {
    const root = makeFixture();
    const result = await runKnowledgeLint({ rootDir: root, fixSuggestions: true });

    expect(result.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ods_missing_sha256',
          action: expect.stringContaining('sha256'),
        }),
        expect.objectContaining({
          type: 'missing_quality_signal',
          action: expect.stringContaining('confidence'),
        }),
        expect.objectContaining({
          type: 'broken_wikilink',
          action: expect.stringContaining('missing-target'),
        }),
        expect.objectContaining({
          type: 'incomplete_ads_group',
          action: expect.stringContaining('补齐 ADS 三件套'),
        }),
      ])
    );
  });

  test('formats markdown suggestions', async () => {
    const result = await runKnowledgeLint({ rootDir: makeFixture(), fixSuggestions: true });
    const markdown = formatLintSuggestions(result);

    expect(markdown).toContain('# 知识修复建议');
    expect(markdown).toContain('ods_missing_sha256');
    expect(markdown).toContain('missing_quality_signal');
    expect(markdown).toContain('不会自动修改正文');
  });
});
