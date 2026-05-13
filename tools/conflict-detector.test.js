import { describe, expect, test } from 'bun:test';
import { runAllDetections } from '../.claude/hooks/conflict-detector.js';

describe('conflict-detector', () => {
  test('malformed semantic rule entries do not suppress secret detection', async () => {
    const conflicts = await runAllDetections(
      [
        '# Hook Review Smoke Test',
        '',
        'OPENAI_API_KEY=sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ].join('\n'),
      '00_DIM/tmp-hook-review.md',
      [
        {
          id: 'format-rule-without-semantic-fields',
          name: '格式规则',
          severity: 'warning',
          type: '格式验证',
        },
      ],
      process.cwd()
    );

    expect(conflicts.some((conflict) => conflict.name === '检测到 OpenAI API Key')).toBe(true);
  });
});
