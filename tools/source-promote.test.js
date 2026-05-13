import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildDwdCandidate, promoteSource } from './source-promote.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-source-promote-'));
  mkdirSync(join(root, '01_ODS', 'fromArticle'), { recursive: true });

  const sourcePath = join(root, '01_ODS', 'fromArticle', '2026-05-08-example.md');
  const sourceContent = [
    '---',
    'title: Example Source',
    'source_url: https://example.com/source',
    'ingested: 2026-05-08',
    'sha256: abc123',
    '---',
    '# Example Source',
    '',
    '第一段说明这个材料用于测试 ODS 到 DWD 的候选生成。',
    '',
    '第二段包含更多上下文，但不应该改写 ODS 文件。',
  ].join('\n');
  writeFileSync(sourcePath, sourceContent);

  return { root, sourcePath, sourceContent };
}

describe('source-promote', () => {
  test('builds a DWD candidate from an ODS source without editing the source', async () => {
    const { root, sourcePath, sourceContent } = makeFixture();

    const result = await promoteSource({
      rootDir: root,
      source: '01_ODS/fromArticle/2026-05-08-example.md',
      write: false,
    });

    expect(result.targetRelativePath).toBe('02_DWD/fromArticle/2026-05-08-example-分析候选.md');
    expect(result.content).toContain('层级: DWD');
    expect(result.content).toContain('type: derived_from');
    expect(result.content).toContain('target: 01_ODS/fromArticle/2026-05-08-example.md');
    expect(result.content).toContain('sources:');
    expect(result.content).toContain('sha256：abc123');
    expect(result.content).toContain('第一段说明这个材料用于测试');
    expect(readFileSync(sourcePath, 'utf8')).toBe(sourceContent);
    expect(existsSync(join(root, result.targetRelativePath))).toBe(false);
  });

  test('writes a DWD draft candidate only when requested', async () => {
    const { root } = makeFixture();

    const result = await promoteSource({
      rootDir: root,
      source: '01_ODS/fromArticle/2026-05-08-example.md',
      write: true,
    });

    expect(result.written).toBe(true);
    expect(existsSync(join(root, result.targetRelativePath))).toBe(true);
  });

  test('formats a concise candidate body from parsed metadata', () => {
    const candidate = buildDwdCandidate({
      sourceRelativePath: '01_ODS/fromArticle/source.md',
      sourceTitle: 'Source Title',
      sourceUrl: 'https://example.com',
      ingested: '2026-05-08',
      sha256: 'hash',
      body: '第一段。\n\n第二段。',
      now: new Date('2026-05-08T06:00:00.000Z'),
    });

    expect(candidate).toContain('# 🔍 明细分析候选：Source Title');
    expect(candidate).toContain('候选用途');
    expect(candidate).toContain('第一段。');
    expect(candidate).toContain('confidence: medium');
  });
});
