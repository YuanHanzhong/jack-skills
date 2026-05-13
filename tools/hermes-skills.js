#!/usr/bin/env bun

import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const DEFAULT_SOURCE_ROOT = '/Users/jack/.hermes/skills';
const DEFAULT_MANIFEST_PATH = join(PROJECT_ROOT, '00_DIM/hermes-skills/manifest.json');
const MANIFEST_SCHEMA_VERSION = 1;
const EXCLUDED_DIRS = new Set(['.git', '.github', '.hub', '.archive', 'node_modules', '__pycache__']);

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function walkFiles(rootDir) {
  const files = [];

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  if (existsSync(rootDir)) {
    visit(rootDir);
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function findSkillFiles(sourceRoot) {
  return walkFiles(sourceRoot).filter((filePath) => basename(filePath) === 'SKILL.md');
}

function hashSkillDirectory(skillDir) {
  const hash = createHash('sha256');
  for (const filePath of walkFiles(skillDir)) {
    const rel = normalizePath(relative(skillDir, filePath));
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function parseSkill({ sourceRoot, skillFile }) {
  const content = readText(skillFile);
  const parsed = matter(content);
  const skillDir = dirname(skillFile);
  const relativeSkillDir = normalizePath(relative(sourceRoot, skillDir));
  const relativeSkillFile = normalizePath(relative(sourceRoot, skillFile));
  const pathParts = relativeSkillDir.split('/').filter(Boolean);
  const fallbackName = pathParts.at(-1) || basename(skillDir);
  const name = String(parsed.data.name || fallbackName).trim();
  const description = String(parsed.data.description || '').trim();
  const category = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : null;
  const id = relativeSkillDir || name;

  return {
    id,
    name,
    category,
    description,
    source: {
      root: sourceRoot,
      skillDir,
      skillFile,
      relativeSkillDir,
      relativeSkillFile,
    },
    frontmatter: parsed.data,
    hashes: {
      skill: sha256(content),
      directory: hashSkillDirectory(skillDir),
    },
  };
}

export function scanHermesSkills({
  sourceRoot = DEFAULT_SOURCE_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH,
  now = new Date(),
} = {}) {
  const resolvedSourceRoot = resolve(sourceRoot);
  if (!existsSync(resolvedSourceRoot)) {
    throw new Error(`Hermes 技能源不存在: ${resolvedSourceRoot}`);
  }

  const skills = findSkillFiles(resolvedSourceRoot)
    .map((skillFile) => parseSkill({ sourceRoot: resolvedSourceRoot, skillFile }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const nameCounts = new Map();
  for (const skill of skills) {
    nameCounts.set(skill.name, (nameCounts.get(skill.name) || 0) + 1);
  }

  const duplicates = [...nameCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    sourceRoot: resolvedSourceRoot,
    count: skills.length,
    duplicateNames: duplicates,
    skills,
  };

  if (manifestPath) {
    const resolvedManifestPath = resolve(manifestPath);
    mkdirSync(dirname(resolvedManifestPath), { recursive: true });
    writeFileSync(resolvedManifestPath, `${stableJson(manifest)}\n`, 'utf8');
  }

  return manifest;
}

export function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const resolvedManifestPath = resolve(manifestPath);
  if (!existsSync(resolvedManifestPath)) {
    throw new Error(`manifest 不存在，请先运行 bun run hermes:skills:scan: ${resolvedManifestPath}`);
  }
  return JSON.parse(readText(resolvedManifestPath));
}

function searchableText(skill) {
  return [
    skill.id,
    skill.name,
    skill.category || '',
    skill.description || '',
    JSON.stringify(skill.frontmatter?.metadata || {}),
  ].join('\n').toLowerCase();
}

function scoreSkill(skill, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  const text = searchableText(skill);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  let score = 0;

  if (skill.id.toLowerCase() === normalizedQuery || skill.name.toLowerCase() === normalizedQuery) {
    score += 1000;
  }
  if (skill.id.toLowerCase().includes(normalizedQuery)) {
    score += 250;
  }
  if (skill.name.toLowerCase().includes(normalizedQuery)) {
    score += 200;
  }
  if ((skill.category || '').toLowerCase().includes(normalizedQuery)) {
    score += 80;
  }
  if ((skill.description || '').toLowerCase().includes(normalizedQuery)) {
    score += 60;
  }

  for (const token of tokens) {
    if (skill.name.toLowerCase().includes(token)) score += 40;
    if (skill.id.toLowerCase().includes(token)) score += 35;
    if ((skill.category || '').toLowerCase().includes(token)) score += 20;
    if ((skill.description || '').toLowerCase().includes(token)) score += 15;
    if (text.includes(token)) score += 5;
  }

  return score;
}

export function searchHermesSkills({
  query,
  manifestPath = DEFAULT_MANIFEST_PATH,
  limit = 10,
} = {}) {
  if (!query || !query.trim()) {
    throw new Error('缺少搜索关键词');
  }

  const manifest = loadManifest(manifestPath);
  return manifest.skills
    .map((skill) => ({ ...skill, score: scoreSkill(skill, query) }))
    .filter((skill) => skill.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function resolveSkill({ selector, manifestPath = DEFAULT_MANIFEST_PATH } = {}) {
  if (!selector || !selector.trim()) {
    throw new Error('缺少 skill 名称或 id');
  }

  const manifest = loadManifest(manifestPath);
  const normalizedSelector = selector.trim().toLowerCase();
  const matches = manifest.skills.filter((skill) => {
    const candidates = [
      skill.id,
      skill.name,
      skill.source?.relativeSkillDir,
      skill.source?.relativeSkillFile,
      skill.source?.skillFile,
    ].filter(Boolean);
    return candidates.some((candidate) => String(candidate).toLowerCase() === normalizedSelector);
  });

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    const options = matches.map((skill) => `${skill.id} -> ${skill.source.skillFile}`).join('\n');
    throw new Error(`skill 名称不唯一，请使用 id：\n${options}`);
  }

  const fuzzy = searchHermesSkills({ query: selector, manifestPath, limit: 5 });
  const suggestions = fuzzy.map((skill) => `- ${skill.id} (${skill.name})`).join('\n');
  throw new Error(`未找到 skill: ${selector}${suggestions ? `\n候选：\n${suggestions}` : ''}`);
}

export function viewHermesSkill({ selector, manifestPath = DEFAULT_MANIFEST_PATH, filePath = 'SKILL.md' } = {}) {
  const skill = resolveSkill({ selector, manifestPath });
  const target = resolve(skill.source.skillDir, filePath);
  const skillDir = resolve(skill.source.skillDir);

  if (!target.startsWith(`${skillDir}/`) && target !== skillDir) {
    throw new Error(`拒绝读取 skill 目录外文件: ${filePath}`);
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error(`skill 文件不存在: ${target}`);
  }

  return {
    skill,
    filePath: target,
    content: readText(target),
  };
}

export function doctorHermesSkills({ manifestPath = DEFAULT_MANIFEST_PATH } = {}) {
  const manifest = loadManifest(manifestPath);
  const current = scanHermesSkills({
    sourceRoot: manifest.sourceRoot,
    manifestPath: null,
  });

  const oldById = new Map(manifest.skills.map((skill) => [skill.id, skill]));
  const newById = new Map(current.skills.map((skill) => [skill.id, skill]));
  const missing = manifest.skills.filter((skill) => !newById.has(skill.id));
  const added = current.skills.filter((skill) => !oldById.has(skill.id));
  const changed = current.skills.filter((skill) => {
    const previous = oldById.get(skill.id);
    return previous && previous.hashes.directory !== skill.hashes.directory;
  });

  const issues = [];
  if (missing.length > 0) issues.push(`${missing.length} 个 manifest 技能已缺失`);
  if (added.length > 0) issues.push(`${added.length} 个新技能尚未写入 manifest`);
  if (changed.length > 0) issues.push(`${changed.length} 个技能内容 hash 已变化`);
  if (current.duplicateNames.length > 0) issues.push(`${current.duplicateNames.length} 个技能名重复`);

  return {
    ok: issues.length === 0,
    issues,
    manifestCount: manifest.count,
    currentCount: current.count,
    missing,
    added,
    changed,
    duplicateNames: current.duplicateNames,
  };
}

function getOption(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function printHelp() {
  console.log(`
Hermes skills router tools

Usage:
  bun run tools/hermes-skills.js scan [--source /Users/jack/.hermes/skills] [--out 00_DIM/hermes-skills/manifest.json]
  bun run tools/hermes-skills.js search <query> [--limit 10] [--json]
  bun run tools/hermes-skills.js view <skill-name-or-id> [--file references/foo.md] [--json]
  bun run tools/hermes-skills.js doctor [--json]

Principle:
  /Users/jack/.hermes/skills/**/SKILL.md remains the single source of truth.
  This repo stores only a generated manifest and routing tools.
`);
}

function printSearchResults(results) {
  if (results.length === 0) {
    console.log('未找到匹配技能');
    return;
  }

  for (const skill of results) {
    console.log(`${skill.id}  score=${skill.score}`);
    console.log(`  name: ${skill.name}`);
    console.log(`  description: ${skill.description || '(无描述)'}`);
    console.log(`  source: ${skill.source.skillFile}`);
  }
}

function printDoctor(result) {
  if (result.ok) {
    console.log(`✅ Hermes skills manifest healthy: ${result.currentCount}/${result.manifestCount} skills`);
    return;
  }

  console.log('❌ Hermes skills manifest needs refresh');
  for (const issue of result.issues) {
    console.log(`- ${issue}`);
  }
  if (result.added.length > 0) {
    console.log(`新增示例: ${result.added.slice(0, 5).map((skill) => skill.id).join(', ')}`);
  }
  if (result.changed.length > 0) {
    console.log(`变化示例: ${result.changed.slice(0, 5).map((skill) => skill.id).join(', ')}`);
  }
  if (result.missing.length > 0) {
    console.log(`缺失示例: ${result.missing.slice(0, 5).map((skill) => skill.id).join(', ')}`);
  }
  if (result.duplicateNames.length > 0) {
    console.log(`重名示例: ${result.duplicateNames.slice(0, 5).map((item) => `${item.name}(${item.count})`).join(', ')}`);
  }
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const manifestPath = getOption(args, '--manifest', DEFAULT_MANIFEST_PATH);
  const json = hasFlag(args, '--json');

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'scan') {
    const sourceRoot = getOption(args, '--source', process.env.HERMES_SKILLS_SOURCE || DEFAULT_SOURCE_ROOT);
    const out = getOption(args, '--out', manifestPath);
    const manifest = scanHermesSkills({ sourceRoot, manifestPath: out });
    if (json) {
      console.log(stableJson(manifest));
    } else {
      console.log(`✅ indexed ${manifest.count} Hermes skills`);
      console.log(`source: ${manifest.sourceRoot}`);
      console.log(`manifest: ${resolve(out)}`);
      if (manifest.duplicateNames.length > 0) {
        console.log(`⚠ duplicate names: ${manifest.duplicateNames.map((item) => `${item.name}(${item.count})`).join(', ')}`);
      }
    }
    return;
  }

  if (command === 'search') {
    const query = args.filter((arg) => !arg.startsWith('--') && arg !== getOption(args, '--limit') && arg !== getOption(args, '--manifest')).join(' ');
    const limit = Number(getOption(args, '--limit', '10'));
    const results = searchHermesSkills({ query, manifestPath, limit });
    if (json) {
      console.log(stableJson(results));
    } else {
      printSearchResults(results);
    }
    return;
  }

  if (command === 'view') {
    const selector = args.find((arg) => !arg.startsWith('--'));
    const filePath = getOption(args, '--file', 'SKILL.md');
    const result = viewHermesSkill({ selector, manifestPath, filePath });
    if (json) {
      console.log(stableJson(result));
    } else {
      console.log(`# ${result.skill.id}`);
      console.log(`source: ${result.filePath}`);
      console.log('');
      console.log(result.content);
    }
    return;
  }

  if (command === 'doctor') {
    const result = doctorHermesSkills({ manifestPath });
    if (json) {
      console.log(stableJson(result));
    } else {
      printDoctor(result);
    }
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}
