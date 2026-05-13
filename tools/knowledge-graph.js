#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');
const SCAN_DIRS = ['02_DWD', '03_DWS', '04_ADS'];

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function rel(rootDir, path) {
  return normalizePath(relative(rootDir, path));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function relationTargets(value) {
  return asArray(value).flatMap((item) => {
    if (!item) return [];
    if (typeof item === 'string') return [{ type: 'relation', target: item }];
    if (typeof item === 'object' && item.target) {
      return [{ type: item.type || 'relation', target: item.target }];
    }
    return [];
  });
}

function extractWikiLinks(content) {
  const withoutFences = content.replace(/```[\s\S]*?```/g, '');
  const links = [];
  const pattern = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
  let match;
  while ((match = pattern.exec(withoutFences)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

function titleFor(path, parsed) {
  if (parsed.data.title) return String(parsed.data.title);
  const heading = parsed.content.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : basename(path, '.md');
}

function pageKey(path) {
  return basename(path, '.md').toLowerCase();
}

async function markdownFiles(rootDir) {
  const files = [];
  for (const dir of SCAN_DIRS) {
    if (!existsSync(join(rootDir, dir))) continue;
    files.push(...await glob(join(rootDir, dir, '**', '*.md'), {
      ignore: ['**/README.md', '**/INDEX.md', '03_DWS/BACKLINKS.md', '03_DWS/知识图谱/knowledge-map.md'],
      windowsPathsNoEscape: true,
    }));
  }
  return files.sort();
}

function resolveWikiLink(link, nodesByKey) {
  const key = link.split('/').pop().toLowerCase();
  return nodesByKey.get(key);
}

function edgeKey(edge) {
  return `${edge.from}|${edge.to}|${edge.type}`;
}

export async function buildKnowledgeGraph({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const files = await markdownFiles(rootDir);
  const nodes = [];
  const nodesByKey = new Map();

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const parsed = matter(raw);
    const path = rel(rootDir, file);
    const node = {
      path,
      title: titleFor(path, parsed),
      layer: path.split('/')[0],
      data: parsed.data,
      content: parsed.content,
    };
    nodes.push(node);
    nodesByKey.set(pageKey(path), path);
  }

  const edgeMap = new Map();
  function addEdge(from, to, type) {
    if (!from || !to) return;
    const edge = { from, to: normalizePath(String(to)), type };
    edgeMap.set(edgeKey(edge), edge);
  }

  nodes.forEach((node) => {
    extractWikiLinks(node.content).forEach((link) => {
      addEdge(node.path, resolveWikiLink(link, nodesByKey), 'wikilink');
    });
    asArray(node.data.sources || node.data['关联ODS'] || node.data['关联DWD']).forEach((source) => {
      addEdge(node.path, source, 'source');
    });
    relationTargets(node.data.relations).forEach((relation) => {
      addEdge(node.path, relation.target, relation.type);
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    nodes: nodes.map(({ content, data, ...node }) => node),
    edges: [...edgeMap.values()].sort((a, b) => `${a.to}${a.from}`.localeCompare(`${b.to}${b.from}`)),
  };
}

function groupedBacklinks(edges) {
  const groups = new Map();
  edges.forEach((edge) => {
    const list = groups.get(edge.to) || [];
    list.push(edge);
    groups.set(edge.to, list);
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function formatBacklinks(graph) {
  const lines = [
    '---',
    '层级: DWS',
    '类型: 反链索引',
    `generated: ${graph.generatedAt}`,
    '---',
    '',
    '# 反链索引',
    '',
    '> 本文件由 `bun run knowledge:graph` 生成。',
    '',
  ];

  groupedBacklinks(graph.edges).forEach(([target, edges]) => {
    lines.push(`## ${target}`, '');
    edges.forEach((edge) => {
      lines.push(`- \`${edge.from}\`（${edge.type}）`);
    });
    lines.push('');
  });

  return lines.join('\n');
}

function mermaidId(path) {
  return `n${Buffer.from(path).toString('hex').slice(0, 16)}`;
}

function mermaidLabel(nodeByPath, path) {
  const node = nodeByPath.get(path);
  return (node?.title || path).replace(/"/g, '\\"');
}

export function formatKnowledgeMap(graph) {
  const nodeByPath = new Map(graph.nodes.map((node) => [node.path, node]));
  const lines = [
    '---',
    '层级: DWS',
    '类型: 知识图谱',
    `generated: ${graph.generatedAt}`,
    '---',
    '',
    '# 知识图谱',
    '',
    '> 本文件由 `bun run knowledge:graph` 生成，展示 DWD / DWS / ADS 的来源、反链与关系边。',
    '',
    '```mermaid',
    'graph TD',
  ];

  graph.nodes.forEach((node) => {
    lines.push(`  ${mermaidId(node.path)}["${mermaidLabel(nodeByPath, node.path)}"]`);
  });
  graph.edges.forEach((edge) => {
    lines.push(`  ${mermaidId(edge.from)} -->|"${edge.type}"| ${mermaidId(edge.to)}`);
  });
  lines.push('```', '', '## 边列表', '', '| 来源 | 关系 | 目标 |', '|---|---|---|');
  graph.edges.forEach((edge) => {
    lines.push(`| \`${edge.from}\` | ${edge.type} | \`${edge.to}\` |`);
  });

  return `${lines.join('\n')}\n`;
}

export async function writeKnowledgeGraph({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const graph = await buildKnowledgeGraph({ rootDir });
  const backlinksPath = '03_DWS/BACKLINKS.md';
  const mapPath = '03_DWS/知识图谱/knowledge-map.md';
  const fullBacklinksPath = join(rootDir, backlinksPath);
  const fullMapPath = join(rootDir, mapPath);

  mkdirSync(dirname(fullBacklinksPath), { recursive: true });
  mkdirSync(dirname(fullMapPath), { recursive: true });
  writeFileSync(fullBacklinksPath, formatBacklinks(graph), 'utf8');
  writeFileSync(fullMapPath, formatKnowledgeMap(graph), 'utf8');

  return {
    backlinksPath,
    mapPath,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  };
}

function parseArgs(args) {
  return {
    write: args.includes('--write'),
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp() {
  console.log(`
知识图谱生成工具

使用方法:
  bun run knowledge:graph
  bun run knowledge:graph -- --write
  bun run knowledge:graph -- --json

说明:
  默认输出 JSON 摘要，不写文件。
  使用 --write 生成 03_DWS/BACKLINKS.md 和 03_DWS/知识图谱/knowledge-map.md。
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.write) {
    const result = await writeKnowledgeGraph({ rootDir: process.cwd() });
    console.log(options.json ? JSON.stringify(result, null, 2) : `✅ 已生成 ${result.backlinksPath} 和 ${result.mapPath}`);
    return;
  }

  const graph = await buildKnowledgeGraph({ rootDir: process.cwd() });
  const summary = {
    generatedAt: graph.generatedAt,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  };
  console.log(options.json ? JSON.stringify(summary, null, 2) : JSON.stringify(summary, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ 知识图谱生成失败: ${error.message}`);
    process.exit(1);
  });
}
