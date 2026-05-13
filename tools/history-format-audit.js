#!/usr/bin/env bun

import { existsSync, readFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');
const SCAN_DIRS = ['02_DWD', '03_DWS', '04_ADS'];
const LAYERS = ['DWD', 'DWS', 'ADS'];
const REQUIRED_SECTIONS = ['当前结论', '精确时间线', '关联内容', '原始证据'];
const REQUIRED_FRONTMATTER = ['canonical_id', 'aliases', 'relations'];

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function rel(rootDir, path) {
  return normalizePath(relative(rootDir, path));
}

function layerFor(relativePath) {
  if (relativePath.startsWith('02_DWD/')) return 'DWD';
  if (relativePath.startsWith('03_DWS/')) return 'DWS';
  if (relativePath.startsWith('04_ADS/')) return 'ADS';
  return 'unknown';
}

async function structuredMarkdownFiles(rootDir) {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const base = join(rootDir, dir);
    if (!existsSync(base)) continue;
    files.push(...await glob(join(base, '**', '*.md'), {
      ignore: [
        '**/INDEX.md',
        '**/README.md',
        '**/node_modules/**',
      ],
      windowsPathsNoEscape: true,
    }));
  }
  return files.sort();
}

function hasFrontmatter(raw) {
  return /^---\r?\n[\s\S]*?\r?\n---/.test(raw);
}

function checkHeadingShape(lines) {
  const issues = [];
  const h1Lines = lines.filter((line) => /^# [^#]/.test(line));

  if (h1Lines.length === 0) {
    issues.push('缺少 H1 标题');
  } else if (h1Lines.length > 1) {
    issues.push(`有 ${h1Lines.length} 个 H1 标题（应只有 1 个）`);
  }

  let lastLevel = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#+)\s/);
    if (!match) continue;
    const level = match[1].length;
    if (lastLevel > 0 && level > lastLevel + 1) {
      issues.push(`第 ${index + 1} 行标题跳级（H${lastLevel} → H${level}）`);
      break;
    }
    lastLevel = level;
  }

  return issues;
}

function checkCodeFences(lines) {
  const issues = [];
  let inCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('```')) continue;
    if (!inCodeBlock) {
      const lang = lines[index].slice(3).trim();
      if (!lang) {
        issues.push(`第 ${index + 1} 行代码块缺少语言标记`);
      }
      inCodeBlock = true;
    } else {
      inCodeBlock = false;
    }
  }

  return issues;
}

function checkHistoricalStructure(raw) {
  const issues = [];
  const parsed = matter(raw);

  if (!hasFrontmatter(raw)) {
    issues.push('缺少 YAML frontmatter');
  } else {
    for (const field of REQUIRED_FRONTMATTER) {
      if (parsed.data[field] === undefined) {
        issues.push(`YAML frontmatter 缺少 ${field}`);
      }
    }
  }

  for (const section of REQUIRED_SECTIONS) {
    const found = new RegExp(`^##\\s+.*${section}`, 'm').test(parsed.content);
    if (!found) {
      issues.push(`缺少「${section}」章节`);
    }
  }

  return issues;
}

function auditMarkdownFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  return [
    ...checkHeadingShape(lines),
    ...checkCodeFences(lines),
    ...checkHistoricalStructure(raw),
  ];
}

function emptyLayerSummary() {
  return {
    DWD: { files: 0, issues: 0 },
    DWS: { files: 0, issues: 0 },
    ADS: { files: 0, issues: 0 },
  };
}

function normalizeLayer(value) {
  if (!value) return null;
  const upper = String(value).toUpperCase();
  if (!LAYERS.includes(upper)) {
    throw new Error(`不支持的 layer: ${value}，可选值：${LAYERS.join(', ')}`);
  }
  return upper;
}

export async function runHistoryFormatAudit({
  rootDir = DEFAULT_ROOT_DIR,
  layer = null,
  problemsOnly = false,
} = {}) {
  const files = [];
  const byLayer = emptyLayerSummary();
  const targetLayer = normalizeLayer(layer);

  for (const fullPath of await structuredMarkdownFiles(rootDir)) {
    const relativePath = rel(rootDir, fullPath);
    const currentLayer = layerFor(relativePath);
    if (targetLayer && currentLayer !== targetLayer) continue;

    const issues = auditMarkdownFile(fullPath);
    if (problemsOnly && issues.length === 0) continue;

    const item = { path: relativePath, layer: currentLayer, issues };

    files.push(item);
    if (byLayer[currentLayer]) {
      byLayer[currentLayer].files += 1;
      byLayer[currentLayer].issues += issues.length;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    scanned: files.length,
    issueCount: files.reduce((count, file) => count + file.issues.length, 0),
    byLayer,
    files,
  };
}

export function formatHistoryFormatAudit(report, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : null;
  const lines = [
    '# 历史格式债 Full Audit',
    '',
    `> 生成时间：${report.generatedAt}`,
    '> 本报告只读扫描历史 DWD/DWS/ADS，不进入 quick audit 阻断链路。',
    '',
    `- 扫描文件：${report.scanned}`,
    `- 问题数量：${report.issueCount}`,
    '',
    '## 分层摘要',
    '',
    '| 层级 | 文件数 | 问题数 |',
    '|---|---:|---:|',
  ];

  for (const layer of ['DWD', 'DWS', 'ADS']) {
    const item = report.byLayer[layer];
    lines.push(`| ${layer} | ${item.files} | ${item.issues} |`);
  }

  const problemFiles = report.files.filter((file) => file.issues.length > 0);
  const visibleProblemFiles = limit === null || limit === 0
    ? problemFiles
    : problemFiles.slice(0, limit);
  lines.push('', '## 问题明细', '');

  if (problemFiles.length === 0) {
    lines.push('- 未发现历史格式债。', '');
    return lines.join('\n');
  }

  for (const file of visibleProblemFiles) {
    lines.push(`### ${file.path}`, '');
    for (const issue of file.issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  if (visibleProblemFiles.length < problemFiles.length) {
    lines.push(`- ...另 ${problemFiles.length - visibleProblemFiles.length} 个问题文件未展开，可用 \`--limit 0\` 查看全部。`, '');
  }

  return lines.join('\n');
}

function parseArgs(args) {
  const layerArg = args.find((arg) => arg.startsWith('--layer='));
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const layerIndex = args.findIndex((arg) => arg === '--layer');
  const limitIndex = args.findIndex((arg) => arg === '--limit');
  return {
    json: args.includes('--json'),
    failOnIssues: args.includes('--fail-on-issues'),
    problemsOnly: args.includes('--problems-only'),
    layer: layerArg ? layerArg.slice('--layer='.length) : (layerIndex >= 0 ? args[layerIndex + 1] : null),
    limit: limitArg ? Number(limitArg.slice('--limit='.length)) : (limitIndex >= 0 ? Number(args[limitIndex + 1]) : null),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp() {
  console.log(`
历史格式债 Full Audit

使用方法:
  bun run history:audit
  bun run history:audit -- --json
  bun run history:audit -- --layer=DWS --problems-only --limit=20
  bun run history:audit -- --fail-on-issues

说明:
  默认只读扫描 02_DWD/03_DWS/04_ADS，跳过 ODS、INDEX.md 和 README.md。
  --layer 可选 DWD/DWS/ADS；--problems-only 只显示有问题文件；--limit 控制 Markdown 明细展开数量，0 表示全部。
  本工具用于历史债务报告，不接入 quick audit 阻断链路。
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const report = await runHistoryFormatAudit({
    rootDir: process.cwd(),
    layer: options.layer,
    problemsOnly: options.problemsOnly,
  });
  console.log(options.json ? JSON.stringify(report, null, 2) : formatHistoryFormatAudit(report, {
    limit: options.limit,
  }));

  if (options.failOnIssues && report.issueCount > 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ 历史格式债审计失败：${error.message}`);
    process.exit(1);
  });
}
