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
  const withoutPrefix = sourceRelativePath.replace(/^01_ODS\//, '');
  const dir = dirname(withoutPrefix);
  const name = withoutPrefix.split('/').pop().replace(/\.md$/i, '');
  return normalizePath(join('02_DWD', dir, `${name}-分析候选.md`));
}

function excerpt(body, maxLength = 600) {
  return body
    .replace(/^# .+$/m, '')
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, maxLength);
}

function yamlString(value) {
  return String(value || '').replace(/"/g, '\\"');
}

export function buildDwdCandidate({
  sourceRelativePath,
  sourceTitle,
  sourceUrl = '',
  ingested = '',
  sha256 = '',
  body,
  now = new Date(),
}) {
  const minute = shanghaiMinute(now);
  const title = sourceTitle || sourceRelativePath.split('/').pop().replace(/\.md$/i, '');
  const sourceExcerpt = excerpt(body);
  const id = canonicalId(`${sourceRelativePath}-analysis-candidate`);

  return [
    '---',
    '层级: DWD',
    '类型: 明细分析候选',
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
    `  - ${sourceRelativePath}`,
    'confidence: medium',
    'contested: false',
    'contradictions: []',
    '---',
    '',
    `# 🔍 明细分析候选：${title}`,
    '',
    '## 当前结论',
    '',
    '本页是由 ODS 原始资料生成的 DWD 分析候选，尚未完成正式分析。需要人工或后续工具继续提炼核心发现、质量信号和关联链接。',
    '',
    '## 精确时间线',
    '',
    `- ${minute}：从 \`${sourceRelativePath}\` 生成 DWD 草稿候选。`,
    '',
    '## 关联内容',
    '',
    `- 原始来源：\`${sourceRelativePath}\``,
    sourceUrl ? `- 来源链接：${sourceUrl}` : '- 来源链接：待补充',
    '- 上游分析：无',
    '- 下游应用：待补充',
    '',
    '## 原始证据',
    '',
    `- ODS 来源：\`${sourceRelativePath}\``,
    `- 获取时间：${ingested || '待补充'}`,
    `- sha256：${sha256 || '待补充'}`,
    '',
    '## 候选用途',
    '',
    '- 提炼这份 ODS 的关键观点、事实、方法或操作步骤。',
    '- 为后续 DWD 正式页提供初稿，不替代人工判断。',
    '- 保持所有关键判断可追溯到 ODS 来源锚点。',
    '',
    '## 初步摘录',
    '',
    sourceExcerpt || '待从 ODS 正文提取。',
    '',
    '## 待分析问题',
    '',
    '- 这份资料解决了什么问题？',
    '- 哪些结论可以沉淀为可复用知识？',
    '- 是否存在低置信度、争议或与既有知识冲突的内容？',
    '- 需要链接到哪些 DWD/DWS 页面以避免孤岛？',
    '',
  ].join('\n');
}

export async function promoteSource({ rootDir = DEFAULT_ROOT_DIR, source, write = false } = {}) {
  if (!source) {
    throw new Error('缺少 ODS 来源路径');
  }
  const sourceRelativePath = normalizePath(source);
  if (!sourceRelativePath.startsWith('01_ODS/') || !sourceRelativePath.endsWith('.md')) {
    throw new Error('source 必须是 01_ODS/ 下的 Markdown 文件');
  }

  const sourcePath = join(rootDir, sourceRelativePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`ODS 来源不存在: ${sourceRelativePath}`);
  }

  const raw = readFileSync(sourcePath, 'utf8');
  const parsed = matter(raw);
  const targetRelativePath = targetPathForSource(sourceRelativePath);
  const targetPath = join(rootDir, targetRelativePath);
  const content = buildDwdCandidate({
    sourceRelativePath,
    sourceTitle: parsed.data.title,
    sourceUrl: parsed.data.source_url || parsed.data.url,
    ingested: parsed.data.ingested || parsed.data.date,
    sha256: parsed.data.sha256,
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
ODS 到 DWD 候选生成工具

使用方法:
  bun run source:promote -- 01_ODS/fromArticle/example.md
  bun run source:promote -- 01_ODS/fromArticle/example.md --write
  bun run source:promote -- 01_ODS/fromArticle/example.md --json

说明:
  默认只输出 DWD 草稿候选，不写文件。
  使用 --write 时写入 02_DWD 对应目录，且不会覆盖已有文件。
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await promoteSource({
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
    console.error(`❌ ODS 晋级候选生成失败: ${error.message}`);
    process.exit(1);
  });
}
