#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function shanghaiMinute(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function canonicalId(input) {
  return input
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function targetPathForSource(sourceRelativePath) {
  const withoutPrefix = sourceRelativePath.replace(/^02_DWD\//, '');
  const dir = dirname(withoutPrefix);
  const name = withoutPrefix.split('/').pop().replace(/\.md$/i, '');
  return normalizePath(join('03_DWS', dir, `${name}-主题候选.md`));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function extractCurrentConclusion(body) {
  const match = body.match(/## 当前结论\s*\n+([\s\S]*?)(?=\n## |\n# |$)/);
  if (!match) {
    return body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
      .join('\n');
  }
  return match[1].trim();
}

function yamlString(value) {
  return String(value || '').replace(/"/g, '\\"');
}

export function buildDwsCandidate({
  sourceRelativePath,
  sourceTitle,
  sources = [],
  confidence = 'medium',
  contested = false,
  body,
  now = new Date(),
}) {
  const minute = shanghaiMinute(now);
  const title = sourceTitle || sourceRelativePath.split('/').pop().replace(/\.md$/i, '');
  const id = canonicalId(`${sourceRelativePath}-topic-candidate`);
  const inheritedSources = asArray(sources);
  const conclusion = extractCurrentConclusion(body);

  return [
    '---',
    '层级: DWS',
    '类型: 主题整合候选',
    `created: ${minute}`,
    `updated: ${minute}`,
    'status: 草稿',
    `canonical_id: ${id}`,
    'aliases:',
    `  - "${yamlString(title)}"`,
    'relations:',
    '  - type: derived_from',
    `    target: ${sourceRelativePath}`,
    'sources:',
    ...inheritedSources.map((source) => `  - ${source}`),
    `confidence: ${confidence || 'medium'}`,
    `contested: ${Boolean(contested)}`,
    'contradictions: []',
    '---',
    '',
    `# 📚 主题整合候选：${title}`,
    '',
    '## 当前结论',
    '',
    conclusion || '待从 DWD 明细分析中提炼稳定主题结论。',
    '',
    '## 精确时间线',
    '',
    `- ${minute}：从 \`${sourceRelativePath}\` 生成 DWS 主题候选。`,
    '',
    '## 关联内容',
    '',
    `- 上游 DWD：\`${sourceRelativePath}\``,
    ...inheritedSources.map((source) => `- 原始证据：\`${source}\``),
    '- 下游应用：待补充',
    '',
    '## 原始证据',
    '',
    `- DWD 来源：\`${sourceRelativePath}\``,
    ...inheritedSources.map((source) => `- 继承来源：\`${source}\``),
    '',
    '## 候选用途',
    '',
    '- 将 DWD 明细分析中的稳定结论整合为主题层知识。',
    '- 检查来源链、争议状态、反链和后续 ADS 应用场景。',
    '- 通过人工审查后再改为正式 DWS 页面。',
    '',
    '## 待整合问题',
    '',
    '- 这个主题的最高层结论是什么？',
    '- 哪些明细证据最能支撑该结论？',
    '- 需要合并或链接哪些相关 DWD/DWS 页面？',
    '- 是否可以进入 ADS 作为行动依据？',
    '',
  ].join('\n');
}

export async function promoteDwd({ rootDir = DEFAULT_ROOT_DIR, source, write = false } = {}) {
  if (!source) {
    throw new Error('缺少 DWD 来源路径');
  }
  const sourceRelativePath = normalizePath(source);
  if (!sourceRelativePath.startsWith('02_DWD/') || !sourceRelativePath.endsWith('.md')) {
    throw new Error('source 必须是 02_DWD/ 下的 Markdown 文件');
  }

  const sourcePath = join(rootDir, sourceRelativePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`DWD 来源不存在: ${sourceRelativePath}`);
  }

  const raw = readFileSync(sourcePath, 'utf8');
  const parsed = matter(raw);
  const targetRelativePath = targetPathForSource(sourceRelativePath);
  const targetPath = join(rootDir, targetRelativePath);
  const content = buildDwsCandidate({
    sourceRelativePath,
    sourceTitle: parsed.data.title,
    sources: asArray(parsed.data.sources || parsed.data['关联ODS']),
    confidence: parsed.data.confidence,
    contested: parsed.data.contested,
    body: parsed.content,
  });

  if (write) {
    if (existsSync(targetPath)) {
      throw new Error(`目标已存在，避免覆盖: ${targetRelativePath}`);
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }

  return {
    sourceRelativePath,
    targetRelativePath,
    targetPath,
    content,
    written: write,
  };
}

function parseArgs(args) {
  const source = args.find((arg) => !arg.startsWith('-'));
  return {
    source,
    write: args.includes('--write'),
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp() {
  console.log(`
DWD 到 DWS 候选生成工具

使用方法:
  bun run dwd:promote -- 02_DWD/fromArticle/concept.md
  bun run dwd:promote -- 02_DWD/fromArticle/concept.md --write
  bun run dwd:promote -- 02_DWD/fromArticle/concept.md --json

说明:
  默认只输出 DWS 主题候选，不写文件。
  使用 --write 时写入 03_DWS 对应目录，且不会覆盖已有文件。
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await promoteDwd({
    rootDir: process.cwd(),
    source: options.source,
    write: options.write,
  });

  if (options.json) {
    console.log(JSON.stringify({
      source: result.sourceRelativePath,
      target: result.targetRelativePath,
      written: result.written,
    }, null, 2));
    return;
  }

  if (result.written) {
    console.log(`✅ 已生成 ${relative(process.cwd(), result.targetPath)}`);
    return;
  }

  console.log(result.content);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ DWD 晋级候选生成失败: ${error.message}`);
    process.exit(1);
  });
}
