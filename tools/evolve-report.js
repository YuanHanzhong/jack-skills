#!/usr/bin/env bun

import { analyzeEvolution, formatMarkdownReport } from './evolution-core.js';

function parseArgs(args) {
  const options = {
    rootDir: process.cwd(),
    json: false,
    limit: 50,
  };

  for (const arg of args) {
    if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--root=')) {
      options.rootDir = arg.slice('--root='.length);
    } else if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) options.limit = parsed;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
自我进化只读报告

用法：
  bun run evolve:report
  bun run evolve:report --json
  bun run evolve:report --limit=100

说明：
  只扫描 memory、rules、skills、sessions 并输出建议，不写入任何文件。
`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    showHelp();
    return;
  }

  const report = analyzeEvolution(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatMarkdownReport(report));
}

main();
