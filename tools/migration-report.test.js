import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildMigrationReport, formatMigrationReport, writeMigrationReport } from './migration-report.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kms-migration-report-'));
  mkdirSync(join(root, '01_ODS', 'fromArticle'), { recursive: true });
  mkdirSync(join(root, '02_DWD', 'fromArticle'), { recursive: true });
  mkdirSync(join(root, '03_DWS', 'insights'), { recursive: true });

  writeFileSync(join(root, '01_ODS', 'fromArticle', 'a.md'), ['---', 'title: A', '---', '# A'].join('\n'));
  writeFileSync(join(root, '02_DWD', 'fromArticle', 'b.md'), ['---', 'title: B', '---', '# B'].join('\n'));

  return root;
}

describe('migration-report', () => {
  test('summarizes known migration debt from health checks', async () => {
    const report = await buildMigrationReport({ rootDir: makeFixture() });

    expect(report.summary.odsMissingSha256).toBe(1);
    expect(report.summary.missingConfidence).toBeGreaterThan(0);
    expect(report.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priority: 'P0', topic: 'ODS sha256 元数据' }),
        expect.objectContaining({ priority: 'P1', topic: '主题质量信号' }),
      ])
    );
  });

  test('formats and writes the migration report', async () => {
    const root = makeFixture();
    const report = await buildMigrationReport({ rootDir: root });
    const markdown = formatMigrationReport(report);
    const result = await writeMigrationReport({ rootDir: root });

    expect(markdown).toContain('# 知识存量迁移报告');
    expect(markdown).toContain('ODS sha256 元数据');
    expect(result.path).toMatch(/^03_DWS\/insights\/\d{2}-\d{4}-\d{2}-知识存量迁移报告\.md$/);
    expect(existsSync(join(root, result.path))).toBe(true);
  });
});
