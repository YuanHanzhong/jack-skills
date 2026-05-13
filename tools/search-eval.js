#!/usr/bin/env bun

import { existsSync, readFileSync } from 'fs';
import { basename, join, relative } from 'path';
import { glob } from 'glob';

const DEFAULT_EVAL_PATH = '00_DIM/evals/search-eval.md';
const SEARCH_DIRS = ['00_DIM', '02_DWD', '03_DWS', '04_ADS'];
const GENERATED_EVAL_IGNORES = [
  '00_DIM/evals/',
  '03_DWS/sessions/知识库日报/',
];
const STOP_TERMS = new Set([
  '如何',
  '怎么',
  '应该',
  '哪些',
  '什么',
  '一个',
  '同一个',
  '是否',
  '可以',
  '需要',
]);

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function rel(rootDir, path) {
  return normalizePath(relative(rootDir, path));
}

function tokenize(text) {
  const raw = String(text)
    .toLowerCase()
    .match(/[\p{Script=Han}]+|[a-z0-9_-]{2,}/gu);
  if (!raw) return [];

  const terms = [];
  for (const token of raw) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      if (token.length <= 3) {
        terms.push(token);
      } else {
        for (let size = 2; size <= 4; size += 1) {
          for (let index = 0; index <= token.length - size; index += 1) {
            terms.push(token.slice(index, index + size));
          }
        }
      }
    } else {
      terms.push(token);
    }
  }

  return [...new Set(terms)].filter((term) => !STOP_TERMS.has(term));
}

function parseEvalSet(content) {
  const items = [];
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const questionMatch = lines[index].match(/^\s*-\s*问题：(.+?)\s*$/);
    if (!questionMatch) continue;

    const item = {
      question: questionMatch[1].trim(),
      expected: [],
    };

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (/^\s*-\s*问题：/.test(line)) break;
      const expectedMatch = line.match(/^\s*-\s*期望：(.+?)\s*$/);
      if (expectedMatch) {
        item.expected.push(expectedMatch[1].trim());
      }
    }

    if (item.expected.length > 0) items.push(item);
  }

  return items;
}

async function loadCorpus(rootDir) {
  const files = [];
  for (const dir of SEARCH_DIRS) {
    const base = join(rootDir, dir);
    if (!existsSync(base)) continue;
    files.push(...await glob(join(base, '**', '*.md'), {
      ignore: ['**/node_modules/**'],
      windowsPathsNoEscape: true,
    }));
  }

  return files
    .filter((file) => {
      const relativePath = rel(rootDir, file);
      return !GENERATED_EVAL_IGNORES.some((prefix) => relativePath.startsWith(prefix));
    })
    .map((file) => ({
    path: rel(rootDir, file),
    title: basename(file, '.md'),
    content: readFileSync(file, 'utf8'),
  }));
}

function rankDocs(query, corpus) {
  const terms = tokenize(query);
  const docFrequency = new Map();
  for (const term of terms) {
    docFrequency.set(
      term,
      corpus.filter((doc) => `${doc.path}\n${doc.title}\n${doc.content}`.toLowerCase().includes(term)).length,
    );
  }

  return corpus
    .map((doc) => {
      const path = doc.path.toLowerCase();
      const title = doc.title.toLowerCase();
      const content = doc.content.toLowerCase();
      const score = terms.reduce((sum, term) => {
        const df = docFrequency.get(term) || 1;
        const weight = Math.log((corpus.length + 1) / df);
        let termScore = 0;
        if (content.includes(term)) termScore += weight;
        if (title.includes(term) || path.includes(term)) termScore += weight * 2;
        return sum + termScore;
      }, 0);
      const layerBoost = doc.path.startsWith('00_DIM/rules/') ? 1.75 : 1;
      return { ...doc, score: score * layerBoost };
    })
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

export async function runSearchEval({
  rootDir = process.cwd(),
  evalPath = DEFAULT_EVAL_PATH,
  topK = 5,
} = {}) {
  const fullEvalPath = join(rootDir, evalPath);
  if (!existsSync(fullEvalPath)) {
    throw new Error(`搜索评估集不存在：${evalPath}`);
  }

  const items = parseEvalSet(readFileSync(fullEvalPath, 'utf8'));
  const corpus = await loadCorpus(rootDir);
  const evaluated = items.map((item) => {
    const hits = rankDocs(item.question, corpus).slice(0, topK);
    const hitPaths = hits.map((hit) => hit.path);
    const passed = item.expected.some((expected) => hitPaths.includes(expected));
    return {
      ...item,
      passed,
      hits: hits.map((hit) => ({ path: hit.path, score: hit.score })),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    evalPath,
    total: evaluated.length,
    passed: evaluated.filter((item) => item.passed).length,
    failed: evaluated.filter((item) => !item.passed).length,
    items: evaluated,
  };
}

export function formatSearchEvalReport(result) {
  return [
    '# 搜索评估报告',
    '',
    `> 生成时间：${result.generatedAt}`,
    `> 评估集：${result.evalPath}`,
    '',
    `- 总数：${result.total}`,
    `- 通过：${result.passed}`,
    `- 失败：${result.failed}`,
    '',
    '## 明细',
    '',
    ...result.items.flatMap((item) => [
      `### ${item.passed ? '✅' : '❌'} ${item.question}`,
      '',
      `- 期望：${item.expected.join(', ')}`,
      `- 命中：${item.hits.map((hit) => `${hit.path}(${hit.score})`).join(', ') || '无'}`,
      '',
    ]),
  ].join('\n');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const json = args.has('--json');
  const failOnIssues = args.has('--fail-on-issues');
  const result = await runSearchEval();

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatSearchEvalReport(result));
  }

  if (failOnIssues && result.failed > 0) {
    process.exit(1);
  }
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('tools/search-eval.js')) {
  main().catch((error) => {
    console.error(`❌ 搜索评估失败: ${error.message}`);
    process.exit(1);
  });
}
