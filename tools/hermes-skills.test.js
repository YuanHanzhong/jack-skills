import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, test } from 'bun:test';
import {
  doctorHermesSkills,
  scanHermesSkills,
  searchHermesSkills,
  viewHermesSkill,
} from './hermes-skills.js';

function makeTempSkillRoot() {
  const root = mkdtempSync(join(tmpdir(), 'hermes-skills-test-'));

  const arxivDir = join(root, 'research', 'arxiv');
  mkdirSync(arxivDir, { recursive: true });
  writeFileSync(
    join(arxivDir, 'SKILL.md'),
    `---
name: arxiv
description: Search and retrieve academic papers from arXiv.
---

# Arxiv

Use this skill for paper search.
`,
    'utf8',
  );

  const githubDir = join(root, 'github', 'github-pr-workflow');
  mkdirSync(githubDir, { recursive: true });
  writeFileSync(
    join(githubDir, 'SKILL.md'),
    `---
name: github-pr-workflow
description: Full GitHub pull request lifecycle.
---

# GitHub PR Workflow
`,
    'utf8',
  );

  return root;
}

describe('Hermes skills tools', () => {
  test('scan builds a metadata-only manifest from SKILL.md files', () => {
    const sourceRoot = makeTempSkillRoot();
    const manifestPath = join(sourceRoot, 'manifest.json');
    const manifest = scanHermesSkills({ sourceRoot, manifestPath });

    expect(manifest.count).toBe(2);
    expect(manifest.skills.map((skill) => skill.id)).toEqual([
      'github/github-pr-workflow',
      'research/arxiv',
    ]);
    expect(manifest.skills[0].content).toBeUndefined();
    expect(manifest.skills[0].source.skillFile.endsWith('SKILL.md')).toBe(true);
  });

  test('search returns ranked skills from the manifest', () => {
    const sourceRoot = makeTempSkillRoot();
    const manifestPath = join(sourceRoot, 'manifest.json');
    scanHermesSkills({ sourceRoot, manifestPath });

    const results = searchHermesSkills({ query: 'paper arxiv', manifestPath });

    expect(results[0].id).toBe('research/arxiv');
    expect(results[0].score).toBeGreaterThan(0);
  });

  test('view reads the real source file on demand', () => {
    const sourceRoot = makeTempSkillRoot();
    const manifestPath = join(sourceRoot, 'manifest.json');
    scanHermesSkills({ sourceRoot, manifestPath });

    const result = viewHermesSkill({ selector: 'research/arxiv', manifestPath });

    expect(result.filePath.endsWith('research/arxiv/SKILL.md')).toBe(true);
    expect(result.content).toContain('# Arxiv');
  });

  test('doctor detects a healthy manifest', () => {
    const sourceRoot = makeTempSkillRoot();
    const manifestPath = join(sourceRoot, 'manifest.json');
    scanHermesSkills({ sourceRoot, manifestPath });

    const result = doctorHermesSkills({ manifestPath });

    expect(result.ok).toBe(true);
    expect(result.currentCount).toBe(2);
  });
});
