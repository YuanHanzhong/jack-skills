import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildKnowledgeGraph, formatBacklinks, formatKnowledgeMap, writeKnowledgeGraph } from './knowledge-graph.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-knowledge-graph-'));
  mkdirSync(join(root, '02_DWD', 'topic'), { recursive: true });
  mkdirSync(join(root, '03_DWS', 'topic'), { recursive: true });
  mkdirSync(join(root, '04_ADS', '2_进行中'), { recursive: true });

  writeFileSync(
    join(root, '02_DWD', 'topic', 'concept-a.md'),
    [
      '---',
      'title: Concept A',
      'sources: [01_ODS/source.md]',
      'relations:',
      '  - type: supports',
      '    target: 03_DWS/topic/topic-a.md',
      '---',
      '# Concept A',
      '',
      '连接 [[topic-a]] 和 [[concept-b]]。',
    ].join('\n')
  );
  writeFileSync(
    join(root, '02_DWD', 'topic', 'concept-b.md'),
    ['---', 'title: Concept B', '---', '# Concept B'].join('\n')
  );
  writeFileSync(
    join(root, '03_DWS', 'topic', 'topic-a.md'),
    ['---', 'title: Topic A', 'sources: [02_DWD/topic/concept-a.md]', '---', '# Topic A'].join('\n')
  );
  writeFileSync(
    join(root, '04_ADS', '2_进行中', '26-0508-12-plan-task_plan-demo.md'),
    ['---', 'title: Demo Task', 'relations:', '  - type: uses', '    target: 03_DWS/topic/topic-a.md', '---', '# Demo Task'].join('\n')
  );

  return root;
}

describe('knowledge-graph', () => {
  test('builds graph edges from wikilinks, sources and relations', async () => {
    const graph = await buildKnowledgeGraph({ rootDir: makeFixture() });

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: '02_DWD/topic/concept-a.md',
          to: '03_DWS/topic/topic-a.md',
          type: 'wikilink',
        }),
        expect.objectContaining({
          from: '03_DWS/topic/topic-a.md',
          to: '02_DWD/topic/concept-a.md',
          type: 'source',
        }),
        expect.objectContaining({
          from: '04_ADS/2_进行中/26-0508-12-plan-task_plan-demo.md',
          to: '03_DWS/topic/topic-a.md',
          type: 'uses',
        }),
      ])
    );
  });

  test('formats backlinks and knowledge map markdown', async () => {
    const graph = await buildKnowledgeGraph({ rootDir: makeFixture() });
    const backlinks = formatBacklinks(graph);
    const map = formatKnowledgeMap(graph);

    expect(backlinks).toContain('# 反链索引');
    expect(backlinks).toContain('03_DWS/topic/topic-a.md');
    expect(map).toContain('# 知识图谱');
    expect(map).toContain('```mermaid');
    expect(map).toContain('Concept A');
  });

  test('writes graph files when requested', async () => {
    const root = makeFixture();
    const result = await writeKnowledgeGraph({ rootDir: root });

    expect(result.backlinksPath).toBe('03_DWS/BACKLINKS.md');
    expect(result.mapPath).toBe('03_DWS/知识图谱/knowledge-map.md');
    expect(existsSync(join(root, result.backlinksPath))).toBe(true);
    expect(existsSync(join(root, result.mapPath))).toBe(true);
  });
});
