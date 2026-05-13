#!/usr/bin/env bun
/**
 * rules-sync.js - P0/P1/P2 rule sync script
 *
 * Purpose: When P0 rules in AGENTS.md change, auto-sync to all consumers:
 *   - ~/.hermes/SOUL.md (global default)
 *   - ~/.hermes/profiles/VAR/SOUL.md (per profile)
 *   - 00_DIM/memory.md (Kimi working memory, summary version)
 *
 * Usage:
 *   bun run tools/rules-sync.js -- --level P0    # sync P0 rules (default)
 *   bun run tools/rules-sync.js -- --dry-run     # print changes only, don't write
 *   bun run tools/rules-sync.js -- --verify      # verify all files are consistent
 *
 * Design principles:
 *   - AGENTS.md is the single source of truth
 *   - Only sync P0 rules (hard bans + top protocols + sync mechanism)
 *   - P1/P2 rules are maintained in AGENTS.md only; SOUL.md keeps references
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// ============ Config ============

const AGENTS_PATH = join(ROOT_DIR, 'AGENTS.md');
const MEMORY_PATH = join(ROOT_DIR, '00_DIM', 'memory.md');
const GLOBAL_SOUL_PATH = join('/Users/jack', '.hermes', 'SOUL.md');
const PROFILES_DIR = join('/Users/jack', '.hermes', 'profiles');

const P0_SECTION_MARKER_START = '## 🔴 P0';
const P0_SECTION_MARKER_END = '## 🟠 P1';
const P0_SOUL_MARKER_START = '## 🔴 P0';
const P0_MEMORY_MARKER_START = '### P0';

// Profiles to sync (adjust as needed)
const PROFILES = ['main', 'navigator', 'studypartner', 'explorer', 'temp'];

// ============ Utils ============

function readFile(path) {
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(path, 'utf-8');
}

function writeFile(path, content) {
  writeFileSync(path, content, 'utf-8');
}

function extractP0FromAgents(content) {
  const startIdx = content.indexOf(P0_SECTION_MARKER_START);
  if (startIdx === -1) {
    throw new Error(`Cannot find P0 section start marker: ${P0_SECTION_MARKER_START}`);
  }

  const endIdx = content.indexOf(P0_SECTION_MARKER_END, startIdx);
  if (endIdx === -1) {
    throw new Error(`Cannot find P0 section end marker: ${P0_SECTION_MARKER_END}`);
  }

  return content.slice(startIdx, endIdx).trim();
}

function generateP0Summary(fullP0) {
  const lines = fullP0.split('\n');
  const summary = [];

  for (const line of lines) {
    if (line.startsWith('|')) {
      summary.push(line);
      continue;
    }
    if (line.includes('P0-B1') || line.includes('P0-B2') || line.includes('P0-B3') || line.includes('P0-C')) {
      summary.push(line);
      continue;
    }
    if (line.startsWith('### ') || line.startsWith('#### ')) {
      if (line.includes('P0-A') || line.includes('P0-B') || line.includes('P0-C')) {
        summary.push(line);
      }
      continue;
    }
  }

  return summary.join('\n').trim();
}

function replaceP0InContent(content, newP0Block, markerStart, markerEnd) {
  const startIdx = content.indexOf(markerStart);

  if (startIdx === -1) {
    return content.trim() + '\n\n' + newP0Block + '\n';
  }

  let endIdx = content.length;
  const lines = content.slice(startIdx).split('\n');

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,2}\s/.test(line) && !line.includes('P0')) {
      endIdx = startIdx + lines.slice(0, i).join('\n').length;
      break;
    }
    if (line.trim().startsWith('<!--') && !line.includes('P0')) {
      endIdx = startIdx + lines.slice(0, i).join('\n').length;
      break;
    }
  }

  const before = content.slice(0, startIdx).trimEnd();
  const after = content.slice(endIdx).trimStart();

  return before + '\n\n' + newP0Block + '\n\n' + after;
}

function syncProfile(profile, p0Block, dryRun = false) {
  const soulPath = join(PROFILES_DIR, profile, 'SOUL.md');
  if (!existsSync(soulPath)) {
    console.log(`  [SKIP] ${profile}: SOUL.md not found`);
    return { status: 'skip', reason: 'not found' };
  }

  const content = readFile(soulPath);
  const hasP0 = content.includes(P0_SOUL_MARKER_START) || content.includes('P0-A');

  if (hasP0) {
    const existingStart = content.indexOf(P0_SOUL_MARKER_START);
    if (existingStart !== -1) {
      const existingBlock = content.slice(existingStart, existingStart + p0Block.length);
      if (existingBlock.trim() === p0Block.trim()) {
        console.log(`  [OK] ${profile}: already up-to-date`);
        return { status: 'ok', reason: 'up-to-date' };
      }
    }
  }

  const newContent = replaceP0InContent(content, p0Block, P0_SOUL_MARKER_START, '##');

  if (dryRun) {
    console.log(`  [DRY-RUN] ${profile}: would update`);
    return { status: 'dry-run', reason: 'would update' };
  }

  writeFile(soulPath, newContent);
  console.log(`  [UPDATED] ${profile}`);
  return { status: 'updated', reason: 'synced' };
}

function syncMemory(p0Full, dryRun = false) {
  if (!existsSync(MEMORY_PATH)) {
    console.log(`  [SKIP] memory.md: not found`);
    return { status: 'skip', reason: 'not found' };
  }

  const content = readFile(MEMORY_PATH);
  const summaryBlock = generateP0Summary(p0Full);

  const hasP0 = content.includes(P0_MEMORY_MARKER_START);

  if (hasP0) {
    const existingStart = content.indexOf(P0_MEMORY_MARKER_START);
    const existingEnd = content.indexOf('§', existingStart + 1);
    const existingBlock = content.slice(existingStart, existingEnd !== -1 ? existingEnd : existingStart + summaryBlock.length);

    if (existingBlock.trim() === summaryBlock.trim()) {
      console.log(`  [OK] memory.md: already up-to-date`);
      return { status: 'ok', reason: 'up-to-date' };
    }
  }

  const insertMarker = 'Project uses DIM';
  const markerIdx = content.indexOf(insertMarker);

  let newContent;
  if (markerIdx !== -1) {
    const lineEnd = content.indexOf('\n', markerIdx);
    const insertPos = lineEnd !== -1 ? lineEnd + 1 : content.length;
    newContent = content.slice(0, insertPos) + '\n' + summaryBlock + '\n' + content.slice(insertPos);
  } else {
    newContent = replaceP0InContent(content, summaryBlock, P0_MEMORY_MARKER_START, '§');
  }

  if (dryRun) {
    console.log(`  [DRY-RUN] memory.md: would update`);
    return { status: 'dry-run', reason: 'would update' };
  }

  writeFile(MEMORY_PATH, newContent);
  console.log(`  [UPDATED] memory.md`);
  return { status: 'updated', reason: 'synced' };
}

function verifySync(p0Full) {
  const results = [];
  const expectedHash = hashContent(p0Full);

  const agentsContent = readFile(AGENTS_PATH);
  const agentsP0 = extractP0FromAgents(agentsContent);
  results.push({
    file: 'AGENTS.md',
    status: hashContent(agentsP0) === expectedHash ? 'ok' : 'mismatch',
  });

  for (const profile of PROFILES) {
    const soulPath = join(PROFILES_DIR, profile, 'SOUL.md');
    if (!existsSync(soulPath)) {
      results.push({ file: `profiles/${profile}/SOUL.md`, status: 'missing' });
      continue;
    }
    const content = readFile(soulPath);
    const hasP0 = content.includes('P0-A');
    results.push({
      file: `profiles/${profile}/SOUL.md`,
      status: hasP0 ? 'ok' : 'missing-p0',
    });
  }

  if (existsSync(GLOBAL_SOUL_PATH)) {
    const content = readFile(GLOBAL_SOUL_PATH);
    const hasP0 = content.includes('P0-A');
    results.push({
      file: '.hermes/SOUL.md',
      status: hasP0 ? 'ok' : 'missing-p0',
    });
  } else {
    results.push({ file: '.hermes/SOUL.md', status: 'missing' });
  }

  if (existsSync(MEMORY_PATH)) {
    const content = readFile(MEMORY_PATH);
    const hasP0 = content.includes(P0_MEMORY_MARKER_START);
    results.push({
      file: '00_DIM/memory.md',
      status: hasP0 ? 'ok' : 'missing-p0',
    });
  } else {
    results.push({ file: '00_DIM/memory.md', status: 'missing' });
  }

  return results;
}

function hashContent(content) {
  return content.trim().slice(0, 200);
}

// ============ Main ============

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verify = args.includes('--verify');
  const level = args.includes('--level') ? args[args.indexOf('--level') + 1] : 'P0';

  console.log(`rules-sync: level=${level}, dry-run=${dryRun}, verify=${verify}\n`);

  if (level !== 'P0') {
    console.log('Warning: Currently only P0 level sync is supported. Use --level P0');
    process.exit(1);
  }

  let agentsContent;
  try {
    agentsContent = readFile(AGENTS_PATH);
  } catch (e) {
    console.error(`Error: Cannot read AGENTS.md: ${e.message}`);
    process.exit(1);
  }

  const p0Block = extractP0FromAgents(agentsContent);
  console.log(`Extracted P0 block from AGENTS.md: ${p0Block.split('\n').length} lines\n`);

  if (verify) {
    console.log('Verification mode:\n');
    const results = verifySync(p0Block);
    let okCount = 0;
    let failCount = 0;

    for (const r of results) {
      const icon = r.status === 'ok' ? 'OK' : 'FAIL';
      console.log(`  [${icon}] ${r.file}: ${r.status}`);
      if (r.status === 'ok') okCount++;
      else failCount++;
    }

    console.log(`\nResult: ${okCount} OK, ${failCount} issues`);
    process.exit(failCount > 0 ? 1 : 0);
  }

  console.log('Sync mode:\n');
  const results = [];

  if (existsSync(GLOBAL_SOUL_PATH)) {
    const content = readFile(GLOBAL_SOUL_PATH);
    const newContent = replaceP0InContent(content, p0Block, P0_SOUL_MARKER_START, '##');
    if (dryRun) {
      console.log(`  [DRY-RUN] .hermes/SOUL.md: would update`);
      results.push({ file: '.hermes/SOUL.md', status: 'dry-run' });
    } else {
      writeFile(GLOBAL_SOUL_PATH, newContent);
      console.log(`  [UPDATED] .hermes/SOUL.md`);
      results.push({ file: '.hermes/SOUL.md', status: 'updated' });
    }
  } else {
    console.log(`  [SKIP] .hermes/SOUL.md: not found`);
    results.push({ file: '.hermes/SOUL.md', status: 'skip' });
  }

  for (const profile of PROFILES) {
    const result = syncProfile(profile, p0Block, dryRun);
    results.push({ file: `profiles/${profile}/SOUL.md`, ...result });
  }

  const memResult = syncMemory(p0Block, dryRun);
  results.push({ file: '00_DIM/memory.md', ...memResult });

  const updated = results.filter(r => r.status === 'updated').length;
  const ok = results.filter(r => r.status === 'ok').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  const dry = results.filter(r => r.status === 'dry-run').length;

  console.log(`\nSummary: ${updated} updated, ${ok} up-to-date, ${skipped} skipped${dryRun ? `, ${dry} dry-run` : ''}`);

  if (updated > 0 && !dryRun) {
    console.log('\nTip: Run with --verify to confirm all files are in sync');
  }
}

main();
