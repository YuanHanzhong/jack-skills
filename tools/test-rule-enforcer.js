#!/usr/bin/env node
/**
 * test-rule-enforcer.js — rule-enforcer.js 规则执行器测试
 *
 * 运行：bun tools/test-rule-enforcer.js
 */

import { execSync } from 'child_process';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const PROJECT_ROOT = process.cwd();
const ENFORCER = join(PROJECT_ROOT, '.claude', 'hooks', 'rule-enforcer.js');
const TEST_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'kms-rule-enforcer-'));

let passed = 0;
let failed = 0;

function test(name, input, expectedDecision) {
  try {
    const result = execSync(`bun "${ENFORCER}"`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_ROOT: TEST_PROJECT_ROOT,
      },
      timeout: 10000,
      input: JSON.stringify(input),
    }).trim();

    const parsed = JSON.parse(result);

    const actualDecision =
      parsed.decision ||
      parsed.hookSpecificOutput?.permissionDecision ||
      parsed.permissionDecision;

    if (actualDecision === expectedDecision) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name} — 期望 ${expectedDecision}，实际 ${actualDecision}`);
      const reason =
        parsed.reason ||
        parsed.hookSpecificOutput?.permissionDecisionReason ||
        parsed.permissionDecisionReason;
      if (reason) console.log(`     原因: ${reason.split('\n')[0]}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ ${name} — 执行错误: ${error.message.split('\n')[0]}`);
    failed++;
  }
}

console.log('\n🧪 rule-enforcer.js 规则测试\n');

// R1: ODS 层保护
test('R1: 写入 ODS 层应被拒绝', {
  tool_name: 'Write',
  tool_input: { file_path: '/home/jack/1_learn/01_ODS/test.md', content: 'test' }
}, 'deny');

// R2: INDEX.md 防护
test('R2: 编辑 INDEX.md 应被拒绝', {
  tool_name: 'Edit',
  tool_input: { file_path: '/home/jack/1_learn/03_DWS/INDEX.md', old_string: 'a', new_string: 'b' }
}, 'deny');

// R2b: 架构外 Markdown 防护
test('R2b: 写入编号架构外 Markdown 应被拒绝', {
  tool_name: 'Write',
  tool_input: { file_path: '/home/jack/1_learn/docs/plan.md', content: '# Plan' }
}, 'deny');

// R3: 硬编码路径检测
test('R3: 硬编码 Windows 路径应询问', {
  tool_name: 'Write',
  tool_input: { file_path: '/home/jack/1_learn/tools/test.js', content: 'const p = "C:\\Users\\jack\\file"' }
}, 'ask');

// R4: 平台环境变量检测
test('R4: USERPROFILE 无 fallback 应询问', {
  tool_name: 'Write',
  tool_input: { file_path: '/home/jack/1_learn/tools/test.js', content: 'const dir = process.env.USERPROFILE + "/data"' }
}, 'ask');

// R5: sed 编辑 .js
test('R5: sed 编辑 .js 应被拒绝', {
  tool_name: 'Bash',
  tool_input: { command: "sed -i 's/old/new/' script.js" }
}, 'deny');

// R6: 破坏性 Git 命令
test('R6: git reset --hard 应询问', {
  tool_name: 'Bash',
  tool_input: { command: 'git reset --hard HEAD~1' }
}, 'ask');

// R7: CLAUDE.md 修改
test('R7: 修改 CLAUDE.md 应询问', {
  tool_name: 'Edit',
  tool_input: { file_path: '/home/jack/1_learn/CLAUDE.md', old_string: 'old', new_string: 'new' }
}, 'ask');

// R8: 密钥检测
test('R8: Markdown 包含 OpenAI API Key 应被拒绝', {
  tool_name: 'Write',
  tool_input: { file_path: '/home/jack/1_learn/02_DWD/test.md', content: '我的 key 是 sk-abc123def456ghi789jkl012mno345pqr678' }
}, 'deny');

test('R8: Markdown 包含 GitHub Token 应被拒绝', {
  tool_name: 'Write',
  tool_input: { file_path: '/home/jack/1_learn/02_DWD/test.md', content: 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' }
}, 'deny');

test('R8: Markdown 包含硬编码密码应被拒绝', {
  tool_name: 'Write',
  tool_input: { file_path: '/home/jack/1_learn/02_DWD/test.md', content: 'password = "mySuperSecretPassword123!"' }
}, 'deny');

// R9: STARTT 格式检查（ask 级别）
test('R9: 写 ADS 文档缺少 STARTT 章节应询问', {
  tool_name: 'Write',
  tool_input: { file_path: '/home/jack/1_learn/04_ADS/1_待规划/test.md', content: '# 测试\n'.repeat(35) }
}, 'ask');

// 正常操作不应被阻止
test('正常操作: 编辑普通文件应允许', {
  tool_name: 'Write',
  tool_input: { file_path: '/home/jack/1_learn/tools/test.js', content: 'console.log("hello")' }
}, 'allow');

console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败（共 ${passed + failed} 个测试）\n`);

process.exit(failed > 0 ? 1 : 0);
