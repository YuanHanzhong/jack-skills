#!/usr/bin/env bun
/**
 * install-vscode-extensions.js
 * 安装推荐的 VS Code / Cursor 扩展
 */
import { spawnSync } from 'child_process';

const extensions = [
  'ms-vscode.vscode-json',
  'yzhang.markdown-all-in-one',
  'davidanson.vscode-markdownlint',
];

console.log('安装推荐扩展...');
let successCount = 0;
let failCount = 0;
for (const ext of extensions) {
  const result = spawnSync('code', ['--install-extension', ext], {
    stdio: 'pipe', encoding: 'utf8'
  });
  if (result.status === 0) {
    console.log(`  OK  ${ext}`);
    successCount++;
  } else if (result.error?.code === 'ENOENT') {
    console.error(`  ⚠️  跳过 ${ext}（code 命令不可用，请确认 VS Code/Cursor 已安装且 code 在 PATH 中）`);
    failCount++;
  } else {
    const reason = result.stderr?.trim() || result.stdout?.trim() || `退出码 ${result.status}`;
    console.error(`  ❌ 安装失败 ${ext}: ${reason}`);
    failCount++;
  }
}
console.log(`完成（成功 ${successCount}，失败 ${failCount}）`);
