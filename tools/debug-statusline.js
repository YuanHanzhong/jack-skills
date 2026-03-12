#!/usr/bin/env bun
// Debug wrapper for usage-statusline.js
// Captures raw stdin from Claude Code to a log file, then pipes it to the real script.

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const LOG_PATH = join(HOME, '.claude', '.statusline-debug.log');
const REAL_SCRIPT = join(HOME, '.claude', 'tools', 'usage-statusline.js');

// Read all stdin
let stdinBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { stdinBuf += d; });
process.stdin.on('end', () => {
  // 1. Append raw stdin to debug log with timestamp
  try {
    mkdirSync(join(HOME, '.claude'), { recursive: true });
    const timestamp = new Date().toISOString();
    const separator = '─'.repeat(60);
    const logEntry = `\n${separator}\n[${timestamp}]\n${stdinBuf}\n`;
    appendFileSync(LOG_PATH, logEntry, 'utf8');
  } catch (e) {
    // Don't let logging failures break the pipeline
    process.stderr.write(`[debug-statusline] log write error: ${e.message}\n`);
  }

  // 2. Spawn the real script and pipe the same stdin content to it
  const child = spawn('bun', [REAL_SCRIPT], {
    stdio: ['pipe', 'inherit', 'inherit'],  // pipe stdin, inherit stdout/stderr
  });

  child.stdin.write(stdinBuf);
  child.stdin.end();

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    process.stderr.write(`[debug-statusline] spawn error: ${err.message}\n`);
    process.exit(1);
  });
});
process.stdin.resume();
