import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runSessionCloseout } from './session-closeout.js';

function git(rootDir, args) {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout;
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'session-closeout-'));
  git(root, ['init']);
  mkdirSync(join(root, '00_DIM'), { recursive: true });
  writeFileSync(join(root, '00_DIM', 'memory.md'), 'initial\n', 'utf8');
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'test: initial',
  ]);
  return root;
}

describe('session closeout', () => {
  test('jc blocks when the current model summary is missing', () => {
    const root = makeRepo();
    writeFileSync(join(root, '00_DIM', 'rule.md'), 'changed\n', 'utf8');

    const result = runSessionCloseout({ rootDir: root, mode: 'jc', commit: true });

    expect(result.status).toBe('missing-summary');
    expect(result.committed).toBe(false);
    expect(existsSync(join(root, '00_DIM', 'session-closeout', 'index.jsonl'))).toBe(false);
    expect(git(root, ['status', '--short', '--untracked-files=all'])).toContain('00_DIM/rule.md');
  });

  test('jc blocks when the closeout loop is incomplete', () => {
    const root = makeRepo();
    writeFileSync(join(root, '00_DIM', 'rule.md'), 'changed\n', 'utf8');

    const result = runSessionCloseout({
      rootDir: root,
      mode: 'jc',
      commit: true,
      summary: '本轮完成：把沉淀一下稳定路由到 jc。',
    });

    expect(result.status).toBe('missing-closeout-loop');
    expect(result.committed).toBe(false);
    expect(result.closeoutLoop.missing).toContain('目的澄清');
    expect(result.message).toContain('补全建议');
    expect(existsSync(join(root, '00_DIM', 'session-closeout', 'index.jsonl'))).toBe(false);
  });

  test('jc blocks when only the opening confirmation is missing', () => {
    const root = makeRepo();
    writeFileSync(join(root, '00_DIM', 'rule.md'), 'changed\n', 'utf8');

    const result = runSessionCloseout({
      rootDir: root,
      mode: 'jc',
      commit: true,
      summary: '主题：会话收束报告优化。目的澄清：把沉淀一下稳定路由到 jc。解决的问题：/jc 返回太像机器状态。战略瓶颈：会话收束结果太像任务列表。需求确认：这是保存和提交。计划先行：先写 closeout 记录，再提交。本次进展：让 /jc 报告更可读。实际执行：清理旧入口。验证检测：测试通过。达成判断：当前需求已达成。文件说明：00_DIM/rule.md：更新测试规则文件。',
    });

    expect(result.status).toBe('missing-closeout-loop');
    expect(result.closeoutLoop.missing).toContain('开场确认');
    expect(result.closeoutLoop.missing).not.toContain('目的澄清');
    expect(result.closeoutLoop.missing).not.toContain('需求确认');
    expect(existsSync(join(root, '00_DIM', 'session-closeout', 'index.jsonl'))).toBe(false);
  });

  test('jc blocks when changed-file descriptions are missing', () => {
    const root = makeRepo();
    writeFileSync(join(root, '00_DIM', 'rule.md'), 'changed\n', 'utf8');

    const result = runSessionCloseout({
      rootDir: root,
      mode: 'jc',
      commit: true,
      summary: '开场确认：我理解你真正要达成的是把沉淀一下稳定路由到 jc；需求类型是保存和提交；完成标准是 closeout 索引和 git commit 可验证。主题：会话收束报告优化。目的澄清：把沉淀一下稳定路由到 jc。解决的问题：/jc 返回太像机器状态，不能直接说明本轮工作价值。战略瓶颈：会话收束结果太像任务列表，Jack 无法快速看到推进了什么。需求确认：这是会话收束和提交。计划先行：先写 closeout 记录，再提交。本次进展：让 /jc 结果按主题、问题、瓶颈、进展和文件分组展示。实际执行：清理旧 ja/js 入口。验证检测：检查 closeout 索引和 git commit。达成判断：当前需求已达成。',
    });

    expect(result.status).toBe('missing-closeout-loop');
    expect(result.closeoutLoop.missing).toContain('文件说明');
    expect(existsSync(join(root, '00_DIM', 'session-closeout', 'index.jsonl'))).toBe(false);
  });

  test('jc blocks failure fixes without a failure-evolution block', () => {
    const root = makeRepo();
    writeFileSync(join(root, '00_DIM', 'rule.md'), 'changed\n', 'utf8');

    const result = runSessionCloseout({
      rootDir: root,
      mode: 'jc',
      commit: true,
      summary: '开场确认：我理解你真正要达成的是修复 cron 超时失败；需求类型是系统修复；完成标准是测试通过。主题：Cron 失败修复。目的澄清：让定时任务失败后能自动恢复。解决的问题：修复 cron 超时失败。战略瓶颈：自动化只报错不进化。需求确认：这是执行和系统维护。计划先行：先复现失败，再补 gate。 本次进展：增加 closeout 检查。实际执行：修改 session-closeout。验证检测：测试通过。达成判断：已达成。文件说明：00_DIM/rule.md：更新失败进化规则说明。',
    });

    expect(result.status).toBe('missing-closeout-loop');
    expect(result.closeoutLoop.missing).toContain('失败进化');
    expect(result.message).toContain('失败进化');
    expect(existsSync(join(root, '00_DIM', 'session-closeout', 'index.jsonl'))).toBe(false);
  });

  test('jc accepts failure fixes with a failure-evolution block', () => {
    const root = makeRepo();
    writeFileSync(join(root, '00_DIM', 'rule.md'), 'changed\n', 'utf8');

    const result = runSessionCloseout({
      rootDir: root,
      mode: 'jc',
      commit: false,
      summary: '开场确认：我理解你真正要达成的是修复 cron 超时失败；需求类型是系统修复；完成标准是测试通过。主题：Cron 失败修复。目的澄清：让定时任务失败后能自动恢复。解决的问题：修复 cron 超时失败。战略瓶颈：自动化只报错不进化。需求确认：这是执行和系统维护。计划先行：先复现失败，再补 gate。本次进展：增加 closeout 检查。实际执行：修改 session-closeout。验证检测：测试通过。达成判断：已达成。文件说明：00_DIM/rule.md：更新失败进化规则说明。失败进化：失败现象：cron 超时；根因：长任务没有后台 worker；同类风险：其他自动化也可能只报错；已修复：补 gate；已预防：规则和测试；验证：测试通过；后续：观察下一次 cron。',
    });

    expect(result.status).toBe('recorded');
    expect(result.committed).toBe(false);
    expect(result.report).toContain('Cron 失败修复');
  });

  test('jc does not require failure evolution for explicit no-failure summaries', () => {
    const root = makeRepo();
    writeFileSync(join(root, '00_DIM', 'rule.md'), 'changed\n', 'utf8');

    const result = runSessionCloseout({
      rootDir: root,
      mode: 'jc',
      commit: false,
      summary: '开场确认：我理解你真正要达成的是收束夜间维护；需求类型是保存；完成标准是 closeout 记录可验证。主题：夜间维护收束。目的澄清：记录健康检查结果。解决的问题：维护报告缺少收束。战略瓶颈：自动化状态不够可见。需求确认：这是保存和检查。计划先行：先检查再记录。本次进展：完成健康状态记录。实际执行：写入 closeout。验证检测：测试通过，失败命令：无，未发现错误。达成判断：已达成。文件说明：00_DIM/rule.md：记录健康检查收束说明。',
    });

    expect(result.status).toBe('recorded');
    expect(result.committed).toBe(false);
  });

  test('jc writes a closeout record and commits without pushing', () => {
    const root = makeRepo();
    writeFileSync(join(root, '00_DIM', 'rule.md'), 'changed\n', 'utf8');

    const result = runSessionCloseout({
      rootDir: root,
      mode: 'jc',
      commit: true,
      summary: '开场确认：我理解你真正要达成的是把沉淀一下稳定路由到 jc；需求类型是保存和提交；完成标准是 closeout 索引和 git commit 可验证。主题：会话收束报告优化。目的澄清：把沉淀一下稳定路由到 jc。解决的问题：/jc 返回太像机器状态，不能直接说明本轮工作价值。战略瓶颈：会话收束结果太像任务列表，Jack 无法快速看到推进了什么。需求确认：这是会话收束和提交。计划先行：先写 closeout 记录，再提交。本次进展：让 /jc 结果按主题、问题、瓶颈、进展和文件分组展示。实际执行：清理旧 ja/js 入口。验证检测：检查 closeout 索引和 git commit。达成判断：当前需求已达成。文件说明：00_DIM/rule.md：更新会话收束规则示例，确保 /jc 输出能解释具体文件变化。',
      now: new Date('2026-05-09T04:00:00+08:00'),
    });

    expect(result.status).toBe('committed');
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);

    const index = readFileSync(join(root, '00_DIM', 'session-closeout', 'index.jsonl'), 'utf8');
    expect(index).toContain('"mode":"jc"');
    expect(index).toContain('沉淀一下稳定路由到 jc');
    expect(index).toContain('"closeout_loop"');

    const commit = git(root, ['log', '-1', '--format=%s%n%b']);
    expect(commit).toContain('chore: 会话收束');
    expect(commit).toContain('战略推进');
    expect(commit).toContain('战略瓶颈');
    expect(commit).toContain('00_DIM/rule.md');
    expect(result.report).toContain('### 主题');
    expect(result.report).toContain('### 解决的问题');
    expect(result.report).toContain('### 推进的战略瓶颈');
    expect(result.report).toContain('### 按主题分组的变更文件');
    expect(result.report).toContain('[00_DIM/rule.md]');
    expect(result.report).toContain(`${root}/00_DIM/rule.md`);
    expect(result.report).toContain('DIM规则与记忆：');
    expect(result.report).toContain('更新会话收束规则示例');
    expect(git(root, ['status', '--short']).trim()).toBe('');
  });

  test('jp aggregates prior jc records instead of requiring a current summary', () => {
    const root = makeRepo();
    const indexDir = join(root, '00_DIM', 'session-closeout');
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(
      join(indexDir, 'index.jsonl'),
      `${JSON.stringify({
        mode: 'jc',
        created_at: '2026-05-09T01:00:00.000Z',
        summary: '开场确认：完成标准是测试通过。目的澄清：规则清理。战略瓶颈：规则入口不稳定。需求确认：执行检查。计划先行：先查再改。实际执行：完成规则清理。验证检测：测试通过。达成判断：已达成。',
        commit: 'abc1234',
        changed_files: ['00_DIM/rules/a.md'],
        closeout_loop: { ok: true, missing: [], suggestions: [] },
      })}\n${JSON.stringify({
        mode: 'jc',
        created_at: '2026-05-09T02:00:00.000Z',
        summary: '会话 B：完成技能入口。',
        commit: 'def5678',
        changed_files: ['.agents/skills/session-closeout/SKILL.md'],
      })}\n`,
      'utf8',
    );

    const result = runSessionCloseout({ rootDir: root, mode: 'jp', aggregate: true, commit: false });

    expect(result.status).toBe('aggregate-ready');
    expect(result.aggregateSummary).toContain('规则清理');
    expect(result.aggregateSummary).toContain('会话 B：完成技能入口。');
    expect(result.aggregateSummary).toContain('闭环不完整');
    expect(result.aggregateSummary).not.toContain('transcript');
  });
});
