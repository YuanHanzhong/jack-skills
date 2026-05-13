#!/usr/bin/env bun

import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  doctorHermesSkills,
  scanHermesSkills,
} from './hermes-skills.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const AGENTS_PATH = join(PROJECT_ROOT, 'AGENTS.md');
const HERMES_PROFILES_ROOT = '/Users/jack/.hermes/profiles';
const HERMES_SKILLS_ROOT = '/Users/jack/.hermes/skills';
const MANIFEST_PATH = join(PROJECT_ROOT, '00_DIM/hermes-skills/manifest.json');
const START = '<!-- CODEX_HERMES_BRIDGE_SYNC:START -->';
const END = '<!-- CODEX_HERMES_BRIDGE_SYNC:END -->';
const DEFAULT_OLD_REF_PATTERNS = ['jack-fan-control', 'jack-mac-control'];
const DEFAULT_VERIFY_PROFILES = ['main, navigator, explorer, studypartner, temp'];
const DEFAULT_EXPECTED_SKILL = 'jack-computer-control';
const HERMES_CODEX_RULE_PATH = '/Users/jack/1_learn/00_DIM/rules/Hermes-Codex协作规范.md';

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function parseList(value, fallback) {
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function discoverDirectProfiles(profilesRoot = HERMES_PROFILES_ROOT) {
  try {
    return readdirSync(profilesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  } catch {
    return [];
  }
}

function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    throw new Error(`AGENTS.md 缺少章节: ${heading}`);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ') && lines[i].trim() !== heading) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

export function extractBridgeSummary(agentsText) {
  return [
    section(agentsText, '## 🧷 唯一真实来源原则'),
    section(agentsText, '## 🧩 Hermes 技能路由'),
  ].join('\n\n');
}

export function buildMemoryBlock({
  agentsPath = AGENTS_PATH,
  generatedAt = new Date(),
  agentsText = readText(agentsPath),
} = {}) {
  const summary = extractBridgeSummary(agentsText);
  return `${START}
# Codex-Hermes 协同规则摘要（生成物）

source: ${agentsPath}
procedure_source: ${HERMES_CODEX_RULE_PATH}
updated: ${generatedAt.toISOString()}

> 这是从 AGENTS.md 抽取的 profile memory 摘要，不是第二份规则正文；请以 source 和 procedure_source 为权威。

${summary}

生成方式：\`cd /Users/jack/1_learn && bun run bridge:sync\`。不要手写本块。
${END}`;
}

export function upsertBlock(existing, block) {
  const startIndex = existing.indexOf(START);
  const endIndex = existing.indexOf(END);
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = existing.slice(0, startIndex).trimEnd();
    const after = existing.slice(endIndex + END.length).trim();
    return [before, block, after].filter(Boolean).join('\n\n') + '\n';
  }
  const prefix = existing.trimEnd();
  return [prefix, block].filter(Boolean).join('\n\n') + '\n';
}

function syncProfileMemory({ profilesRoot, profile, block, dryRun }) {
  const profileDir = join(profilesRoot, profile);
  if (!existsSync(profileDir)) {
    return { profile, status: 'missing' };
  }

  const memoryPath = join(profileDir, 'memories', 'MEMORY.md');
  const existing = existsSync(memoryPath) ? readText(memoryPath) : '';
  const next = upsertBlock(existing, block);
  const changed = existing !== next;

  if (changed && !dryRun) {
    mkdirSync(dirname(memoryPath), { recursive: true });
    writeFileSync(memoryPath, next, 'utf8');
  }

  return {
    profile,
    status: changed ? (dryRun ? 'would-update' : 'updated') : 'unchanged',
    memoryPath,
  };
}

function verifyProfileSkill({ profile, expectedSkill }) {
  try {
    const output = execFileSync('hermes', ['-p', profile, 'skills', 'list'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      profile,
      ok: output.includes(expectedSkill),
      output: output
        .split('\n')
        .filter((line) => line.includes(expectedSkill) || line.includes('jack-computer-control') || line.includes('jack-fan-control') || line.includes('jack-mac-control'))
        .join('\n'),
    };
  } catch (error) {
    return {
      profile,
      ok: false,
      error: String(error.stderr || error.message || error),
    };
  }
}

function isLikelyTextFile(filePath) {
  return /\.(md|txt|yaml|yml|json|js|ts|mjs|cjs|sh|bash|zsh|py|toml|env|plist)$/i.test(filePath);
}

function walkFiles(root) {
  try {
    const stat = statSync(root);
    if (!stat.isDirectory()) return [root];
  } catch {
    return [];
  }

  let output = [];
  try {
    output = execFileSync('find', [root, '-type', 'f'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((path) => !path.includes('/.git/') && !path.includes('/backups/') && !path.includes('/node_modules/'));
  } catch {
    return [];
  }
  return output;
}

export function findOldReferences({
  roots = [AGENTS_PATH, join(PROJECT_ROOT, '00_DIM/rules'), HERMES_SKILLS_ROOT, '/Users/jack/.local/bin'],
  patterns = DEFAULT_OLD_REF_PATTERNS,
  limit = 50,
} = {}) {
  const refs = [];
  const needles = patterns.filter(Boolean);
  if (needles.length === 0) return refs;

  for (const root of roots) {
    for (const filePath of walkFiles(root)) {
      for (const needle of needles) {
        if (filePath.includes(needle)) {
          refs.push({ pattern: needle, path: filePath, line: 0, text: '<filename>' });
          if (refs.length >= limit) return refs;
        }
      }

      if (!isLikelyTextFile(filePath)) continue;
      let lines = [];
      try {
        lines = readText(filePath).split('\n');
      } catch {
        continue;
      }
      for (let index = 0; index < lines.length; index += 1) {
        for (const needle of needles) {
          if (lines[index].includes(needle)) {
            refs.push({ pattern: needle, path: filePath, line: index + 1, text: lines[index].trim().slice(0, 200) });
            if (refs.length >= limit) return refs;
          }
        }
      }
    }
  }
  return refs;
}

export function bridgeSync({
  dryRun = false,
  agentsPath = AGENTS_PATH,
  profilesRoot = HERMES_PROFILES_ROOT,
  skillsRoot = HERMES_SKILLS_ROOT,
  manifestPath = MANIFEST_PATH,
  memoryProfiles = null,
  verifyProfiles = DEFAULT_VERIFY_PROFILES,
  expectedSkill = DEFAULT_EXPECTED_SKILL,
  oldRefPatterns = DEFAULT_OLD_REF_PATTERNS,
  now = null,
} = {}) {
  const generatedAt = now || statSync(agentsPath).mtime;
  const block = buildMemoryBlock({ agentsPath, generatedAt });
  const resolvedMemoryProfiles = memoryProfiles ?? discoverDirectProfiles(profilesRoot);

  let manifest = null;
  let doctor = null;
  if (!dryRun) {
    manifest = scanHermesSkills({
      sourceRoot: skillsRoot,
      manifestPath,
      now: generatedAt,
    });
    doctor = doctorHermesSkills({ manifestPath });
  }

  const visibility = verifyProfiles.map((profile) => verifyProfileSkill({ profile, expectedSkill }));
  const oldReferences = findOldReferences({ patterns: oldRefPatterns });
  const memoryResults = resolvedMemoryProfiles.map((profile) => syncProfileMemory({
    profilesRoot,
    profile,
    block,
    dryRun,
  }));
  const changedProfiles = memoryResults
    .filter((item) => item.status === 'updated' || item.status === 'would-update')
    .map((item) => item.profile);

  return {
    dryRun,
    expectedSkill,
    memoryResults,
    manifest: manifest ? { count: manifest.count, path: manifestPath } : null,
    doctor: doctor ? { ok: doctor.ok, currentCount: doctor.currentCount, manifestCount: doctor.manifestCount } : null,
    visibility,
    oldReferences,
    reloadRecommended: changedProfiles,
  };
}

function hasFlag(args, name) {
  return args.includes(name);
}

function option(args, name, fallback = null) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1]) return args[index + 1];
  return fallback;
}

function printResult(result) {
  console.log('# Codex-Hermes bridge sync');
  console.log(`expected skill: ${result.expectedSkill}`);
  console.log('');
  console.log('memory:');
  for (const item of result.memoryResults) {
    console.log(`- ${item.profile}: ${item.status}${item.memoryPath ? ` (${item.memoryPath})` : ''}`);
  }
  if (result.manifest) {
    console.log('');
    console.log(`manifest: indexed ${result.manifest.count} skills -> ${result.manifest.path}`);
  }
  if (result.doctor) {
    console.log(`doctor: ${result.doctor.ok ? 'ok' : 'failed'} (${result.doctor.currentCount}/${result.doctor.manifestCount})`);
  }
  console.log('');
  console.log('profile visibility:');
  for (const item of result.visibility) {
    console.log(`- ${item.profile}: ${item.ok ? 'ok' : 'missing'}`);
    if (item.output) console.log(item.output);
    if (item.error) console.log(`  error: ${item.error.trim()}`);
  }
  console.log('');
  console.log('old references:');
  if (result.oldReferences.length === 0) {
    console.log('- none');
  } else {
    for (const item of result.oldReferences) {
      const where = item.line > 0 ? `${item.path}:${item.line}` : item.path;
      console.log(`- ${item.pattern}: ${where} ${item.text}`);
    }
  }
  console.log('');
  if (result.reloadRecommended.length > 0) {
    console.log(`reload recommended: ${result.reloadRecommended.join(', ')}`);
  } else {
    console.log('reload recommended: none');
  }
}

function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(`Usage: bun run bridge:sync [--dry-run] [--json] [--profiles a,b] [--verify-profiles a,b] [--skill name] [--old-ref a,b]`);
    return;
  }

  const result = bridgeSync({
    dryRun: hasFlag(args, '--dry-run'),
    memoryProfiles: parseList(option(args, '--profiles'), null),
    verifyProfiles: parseList(option(args, '--verify-profiles'), DEFAULT_VERIFY_PROFILES),
    expectedSkill: option(args, '--skill', DEFAULT_EXPECTED_SKILL),
    oldRefPatterns: parseList(option(args, '--old-ref'), DEFAULT_OLD_REF_PATTERNS),
  });

  if (hasFlag(args, '--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResult(result);
  }

  const failed = result.doctor?.ok === false || result.visibility.some((item) => !item.ok);
  if (failed) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}
