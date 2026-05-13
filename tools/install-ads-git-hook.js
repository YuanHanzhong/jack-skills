#!/usr/bin/env bun

import { copyFileSync, chmodSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

const root = runGit(['rev-parse', '--show-toplevel']);
const gitDirRaw = runGit(['rev-parse', '--git-dir']);
const gitDir = gitDirRaw.startsWith('/') ? gitDirRaw : join(root, gitDirRaw);
const source = join(root, 'tools', 'git-hooks', 'pre-commit');
const target = join(gitDir, 'hooks', 'pre-commit');

if (!existsSync(source)) {
  throw new Error(`missing hook source: ${source}`);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
chmodSync(target, 0o755);

console.log(`已安装 ADS pre-commit guard: ${target}`);
