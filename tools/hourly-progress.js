#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const DEFAULT_ROOT_DIR = join(import.meta.dir, '..');

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function runGit(rootDir, args, { allowFail = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });

  if (!allowFail && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

export function parseGitStatus(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
      return {
        status,
        rawPath,
        path: normalizePath(path),
      };
    });
}

function listFilesUnder(rootDir, relativeDir, files = []) {
  const fullDir = join(rootDir, relativeDir);
  if (!existsSync(fullDir)) return files;

  for (const entry of readdirSync(fullDir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const relativePath = normalizePath(join(relativeDir, entry.name));
    const fullPath = join(rootDir, relativePath);
    if (entry.isDirectory()) {
      listFilesUnder(rootDir, `${relativePath}/`, files);
    } else if (entry.isFile() || statSync(fullPath).isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function expandUntrackedDirectories(rootDir, changes) {
  const expanded = [];
  for (const change of changes) {
    if (change.status === '??' && change.path.endsWith('/')) {
      for (const file of listFilesUnder(rootDir, change.path)) {
        expanded.push({ ...change, rawPath: file, path: file });
      }
      continue;
    }
    expanded.push(change);
  }
  return expanded;
}

export function unsafePathReason(path) {
  const normalized = normalizePath(path);
  const lower = normalized.toLowerCase();

  if (normalized.startsWith('01_ODS/')) return '01_ODS 原始资料禁止由自动任务提交';
  if (/(^|\/)\.env($|\.|\/)/.test(normalized)) return '.env 文件禁止自动提交';
  if (/(^|\/)(credentials|credential|secrets?|tokens?)(\.|\/|$)/.test(lower)) {
    return '疑似密钥/凭据文件禁止自动提交';
  }
  if (/\.(pem|key|p12|pfx)$/i.test(normalized)) return '私钥/证书文件禁止自动提交';
  if (/(^|\/)id_rsa($|\.|\/)/.test(lower)) return 'SSH 私钥禁止自动提交';

  return null;
}

function categoryForPath(path) {
  if (path.startsWith('00_方向盘/')) return '方向盘';
  if (path.startsWith('04_ADS/')) return 'ADS任务进展';
  if (path.startsWith('03_DWS/')) return 'DWS沉淀与蓝图';
  if (path.startsWith('02_DWD/')) return 'DWD分析';
  if (path.startsWith('00_DIM/')) return 'DIM规则与记忆';
  if (path.startsWith('tools/')) return '工具自动化';
  if (path.startsWith('.agents/') || path.startsWith('.claude/') || path.startsWith('.cursor/')) {
    return '技能与兼容入口';
  }
  if (path === 'package.json') return '命令入口';
  return '其他工程文件';
}

function summarizeByCategory(changes) {
  const groups = new Map();
  for (const change of changes) {
    const category = categoryForPath(change.path);
    const group = groups.get(category) || { category, count: 0, files: [] };
    group.count += 1;
    group.files.push(change.path);
    groups.set(category, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function readDirectionBottleneck(rootDir) {
  const path = join(rootDir, '00_方向盘', '03_战略瓶颈.md');
  if (!existsSync(path)) return '未读取到方向盘战略瓶颈，按本轮文件变化归纳。';

  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') && !line.includes('tags:'));

  return lines[0]?.replace(/^- /, '') || '方向盘战略瓶颈存在，但没有可直接抽取的条目。';
}

export function inferBottleneck(rootDir, categories) {
  const names = new Set(categories.map((item) => item.category));

  if (names.has('工具自动化')) {
    return '执行层需要自动留下进展证据，减少 Jack 手动追踪和复盘成本。';
  }
  if (names.has('ADS任务进展')) {
    return 'ADS 任务进展需要持续有痕，避免蓝图只能看到任务列表而看不到推进结果。';
  }
  if (names.has('技能与兼容入口')) {
    return '技能入口需要能复用真实进度证据，减少临场重新解释和重新找上下文。';
  }

  return readDirectionBottleneck(rootDir);
}

export function inferCommitTopic(categories) {
  if (categories.length === 0) return '知识库进展';
  if (categories.length === 1) return categories[0].category;
  return `${categories[0].category}等${categories.length}类进展`;
}

export function inferSolvedProblem(categories) {
  const names = new Set(categories.map((item) => item.category));

  if (names.has('工具自动化')) {
    return '让自动化变更通过 git log 固定证据，避免重复写进展文档。';
  }
  if (names.has('DIM规则与记忆')) {
    return '把稳定执行规则写清楚，减少后续会话靠临场解释。';
  }
  if (names.has('ADS任务进展')) {
    return '把任务状态和真实完成度对齐，避免已完成任务继续停留在进行中。';
  }
  if (names.has('方向盘')) {
    return '让方向盘持续反映 Jack 当前目标、瓶颈和下一步。';
  }

  return '把本轮会话产生的文件变化及时固定为可追溯版本。';
}

function formatCategoryLines(categories) {
  return categories.map((item) => `- ${item.category}：${item.count} 个文件（${item.files.join('、')}）`);
}

export function formatCommitMessage({ topic, solvedProblem, categories, bottleneck }) {
  const subject = `chore: ${topic}`;
  const body = [
    '本次自动提交来自 git 进展辅助入口。',
    '',
    `主题：${topic}`,
    `解决的问题：${solvedProblem}`,
    '',
    `推进的战略瓶颈：${bottleneck}`,
    '',
    '按主题分组的变更文件：',
    ...formatCategoryLines(categories),
  ].join('\n');

  return { subject, body };
}

export function collectChangedFiles(rootDir) {
  const status = runGit(rootDir, [
    '-c',
    'core.quotepath=false',
    'status',
    '--short',
    '--untracked-files=all',
  ]);
  return expandUntrackedDirectories(rootDir, parseGitStatus(status.stdout));
}

export function runHourlyProgress({
  rootDir = DEFAULT_ROOT_DIR,
  apply = false,
} = {}) {
  const changes = collectChangedFiles(rootDir);
  const blockers = changes
    .map((change) => ({ ...change, reason: unsafePathReason(change.path) }))
    .filter((change) => change.reason);

  if (changes.length === 0) {
    return {
      hadChanges: false,
      committed: false,
      message: '最近一小时没有检测到 Git 变更。',
    };
  }

  if (blockers.length > 0) {
    return {
      hadChanges: true,
      committed: false,
      blocked: true,
      blockers,
      message: '检测到禁止自动提交的文件，已跳过小时提交。',
    };
  }

  const categories = summarizeByCategory(changes);
  const topic = inferCommitTopic(categories);
  const solvedProblem = inferSolvedProblem(categories);
  const bottleneck = inferBottleneck(rootDir, categories);
  const commitMessage = formatCommitMessage({
    topic,
    solvedProblem,
    categories,
    bottleneck,
  });

  if (!apply) {
    return {
      hadChanges: true,
      committed: false,
      dryRun: true,
      changes,
      categories,
      topic,
      solvedProblem,
      bottleneck,
      commitMessage,
    };
  }

  // Stage everything once blockers are cleared. Avoid pathspec issues with already-staged deletions.
  runGit(rootDir, ['add', '-A']);

  const staged = runGit(rootDir, ['diff', '--cached', '--quiet'], { allowFail: true });
  if (staged.status === 0) {
    return {
      hadChanges: true,
      committed: false,
      message: '检测到变更但没有可提交的 staged diff。',
    };
  }

  runGit(rootDir, [
    '-c',
    'user.name=Codex Hourly',
    '-c',
    'user.email=codex-hourly@local',
    'commit',
    '-m',
    commitMessage.subject,
    '-m',
    commitMessage.body,
  ]);

  const commit = runGit(rootDir, ['log', '-1', '--format=%h %s']);
  return {
    hadChanges: true,
    committed: true,
    commit: commit.stdout.trim(),
    changes,
    categories,
    topic,
    solvedProblem,
    bottleneck,
  };
}

function parseArgs(args) {
  return {
    apply: args.includes('--apply'),
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printResult(result, json = false) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('# 小时进展检查');
  console.log('');
  console.log(`- 状态：${result.message || (result.committed ? '已提交小时进展' : 'dry-run')}`);
  if (result.blocked) {
    console.log('- 阻塞文件：');
    result.blockers.forEach((item) => console.log(`  - ${item.path}：${item.reason}`));
  }
  if (result.topic) console.log(`- 本次主题：${result.topic}`);
  if (result.solvedProblem) console.log(`- 解决的问题：${result.solvedProblem}`);
  if (result.bottleneck) console.log(`- 推进瓶颈：${result.bottleneck}`);
  if (result.commit) console.log(`- Commit：${result.commit}`);
  if (result.categories) {
    console.log('- 按主题分组的变更文件：');
    formatCategoryLines(result.categories).forEach((line) => console.log(`  ${line}`));
  }
}

function printHelp() {
  console.log(`
小时进展检查

使用方法:
  bun run progress:hourly
  bun run progress:hourly:apply

默认只做 dry-run；--apply 只会本地 git commit，不再写入 DWS 小时进展日志。
`);
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    try {
      printResult(runHourlyProgress({ rootDir: process.cwd(), apply: options.apply }), options.json);
    } catch (error) {
      console.error(`小时进展检查失败：${error.message}`);
      process.exit(1);
    }
  }
}
