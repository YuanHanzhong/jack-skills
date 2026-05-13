import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildDwsCandidate, promoteDwd } from './dwd-promote.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-dwd-promote-'));
  mkdirSync(join(root, '02_DWD', 'fromArticle'), { recursive: true });

  const sourcePath = join(root, '02_DWD', 'fromArticle', 'concept-a.md');
  const sourceContent = [
    '---',
    'title: Concept A',
    'canonical_id: concept-a',
    'sources:',
    '  - 01_ODS/fromArticle/source.md',
    'confidence: high',
    'contested: false',
    '---',
    '# Concept A',
    '',
    '## 当前结论',
    '',
    'Concept A 已经具备可以进入主题层的稳定结论。',
    '',
    '## 核心发现',
    '',
    '- 发现一',
    '- 发现二',
  ].join('\n');
  writeFileSync(sourcePath, sourceContent);

  return { root, sourcePath, sourceContent };
}

describe('dwd-promote', () => {
  test('builds a DWS candidate from a DWD page without editing the source', async () => {
    const { root, sourcePath, sourceContent } = makeFixture();

    const result = await promoteDwd({
      rootDir: root,
      source: '02_DWD/fromArticle/concept-a.md',
      write: false,
    });

    expect(result.targetRelativePath).toBe('03_DWS/fromArticle/concept-a-主题候选.md');
    expect(result.content).toContain('层级: DWS');
    expect(result.content).toContain('type: derived_from');
    expect(result.content).toContain('target: 02_DWD/fromArticle/concept-a.md');
    expect(result.content).toContain('01_ODS/fromArticle/source.md');
    expect(result.content).toContain('Concept A 已经具备可以进入主题层');
    expect(readFileSync(sourcePath, 'utf8')).toBe(sourceContent);
    expect(existsSync(join(root, result.targetRelativePath))).toBe(false);
  });

  test('writes a DWS candidate only when requested', async () => {
    const { root } = makeFixture();

    const result = await promoteDwd({
      rootDir: root,
      source: '02_DWD/fromArticle/concept-a.md',
      write: true,
    });

    expect(result.written).toBe(true);
    expect(existsSync(join(root, result.targetRelativePath))).toBe(true);
  });

  test('formats a DWS candidate with inherited confidence and sources', () => {
    const candidate = buildDwsCandidate({
      sourceRelativePath: '02_DWD/fromArticle/concept-a.md',
      sourceTitle: 'Concept A',
      sources: ['01_ODS/fromArticle/source.md'],
      confidence: 'high',
      contested: false,
      body: '## 当前结论\n\n稳定结论。',
      now: new Date('2026-05-08T06:00:00.000Z'),
    });

    expect(candidate).toContain('# 📚 主题整合候选：Concept A');
    expect(candidate).toContain('confidence: high');
    expect(candidate).toContain('01_ODS/fromArticle/source.md');
    expect(candidate).toContain('稳定结论。');
  });
});
