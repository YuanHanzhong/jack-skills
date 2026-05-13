import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runSearchEval } from './search-eval.js';

describe('search-eval', () => {
  test('scores expected documents against a lightweight markdown eval set', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kms-search-eval-'));
    mkdirSync(join(root, '00_DIM', 'rules'), { recursive: true });
    mkdirSync(join(root, '00_DIM', 'evals'), { recursive: true });

    writeFileSync(
      join(root, '00_DIM', 'rules', '方向盘协作规范.md'),
      '# 方向盘协作规范\n\n方向盘通过 ADS 链接驱动任务流转。\n'
    );
    writeFileSync(
      join(root, '00_DIM', 'evals', 'search-eval.md'),
      [
        '# 搜索评估集',
        '',
        '- 问题：方向盘如何驱动 ADS？',
        '  - 期望：00_DIM/rules/方向盘协作规范.md',
      ].join('\n')
    );

    const result = await runSearchEval({ rootDir: root });

    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.items[0].passed).toBe(true);
  });
});
