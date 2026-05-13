import { existsSync, readFileSync } from 'fs';
import { describe, expect, test } from 'bun:test';
import { searchHermesSkills } from './hermes-skills.js';

const inboxSkillPath = '/Users/jack/.hermes/skills/jack-learning-inbox/SKILL.md';
const inboxReferencePath = '/Users/jack/.hermes/skills/jack-learning-inbox/references/catch-up-review-dry-run.md';
const engineSkillPath = '/Users/jack/.hermes/skills/jack-learning-engine/SKILL.md';

function read(path) {
  return readFileSync(path, 'utf8');
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  expect(match).not.toBeNull();
  return match[1];
}

function expectAll(text, snippets) {
  for (const snippet of snippets) {
    expect(text).toContain(snippet);
  }
}

describe('jack-learning-inbox Hermes skill', () => {
  test('uses the global Hermes skill source and remains visible in manifest search', () => {
    expect(existsSync(inboxSkillPath)).toBe(true);

    const [inbox] = searchHermesSkills({
      query: 'jack-learning-inbox',
      manifestPath: '/Users/jack/1_learn/00_DIM/hermes-skills/manifest.json',
      limit: 1,
    });

    expect(inbox).toBeDefined();
    expect(inbox.id).toBe('jack-learning-inbox');
    expect(inbox.source.skillFile).toBe(inboxSkillPath);
    expect(inbox.content).toBeUndefined();
  });

  test('dedicated skill has searchable frontmatter and required workflow sections', () => {
    expect(existsSync(inboxSkillPath)).toBe(true);

    const skill = read(inboxSkillPath);
    const fm = frontmatter(skill);

    expect(fm).toContain('name: jack-learning-inbox');
    for (const term of [
      '学习收件箱',
      '艾宾浩斯',
      '间隔复习',
      '学会了',
      '理解了',
      '85',
      '假如已经 N 天后',
      '测试复习流程',
      '找不合理的地方',
      '过期复习',
      '多条 pending',
      '不固定题序',
    ]) {
      expect(fm).toContain(term);
    }

    for (const section of [
      '## 触发条件',
      '## 目标确认',
      '## 掌握度评分',
      '## 最小字段',
      '## 写入与 fallback',
      '## 艾宾浩斯复习排期',
      '## 复习题生成',
      '## 自动提醒边界',
      '## 验证清单',
    ]) {
      expect(skill).toContain(section);
    }
  });

  test('dedicated skill captures required data contract and local fallback path', () => {
    const skill = read(inboxSkillPath);

    for (const field of [
      'concept',
      'first_learned_at',
      'mastery_score',
      'next_review_dates',
      'review_count',
      'consecutive_correct',
      'last_answer_quality',
      'source_conversation_cue',
    ]) {
      expect(skill).toContain(field);
    }

    expect(skill).toContain('04_ADS/2_进行中/YY-MMDD-HH-learn-progress-learning-inbox-<concept>.md');
    expect(skill).not.toContain('26-0510-05-learning-inbox-<concept>.md');
    expect(skill).toContain('1/3/7/14/30');
    expect(skill).toContain('review-question');
    expect(skill).toContain('cc-connect cron');
  });

  test('catch-up review rules are dynamic, diagnostic, and mobile-focused', () => {
    const skill = read(inboxSkillPath);
    const reference = read(inboxReferencePath);

    expectAll(skill, [
      '多条复习都过期',
      '一题诊断题',
      '衰减后',
      '移动端',
      '一题只追一个薄弱点',
      '边界',
      '反例',
      '正式复习后显式写回状态',
      'pending/done',
      'mastery_score',
      'review_count',
      'consecutive_correct',
      'last_answer_quality',
      'last_reviewed_at',
      '<65=L1 概念本质',
      '65-84=L2 应用/机制',
      '>=85=L3 边界/反例/迁移',
      '1天内0',
      '1-3天-5',
      '3-7天-10',
      '7-14天-20',
      '14天以上-30',
      'core=true',
      '88',
      '58',
      'catch-up 正式通过',
      '新的 1/3/7/14/30 pending 队列',
      'partial',
      'prompted',
      '不触发 wrong 重置',
      'tools/learning-inbox-review.js',
      'dry-run',
      'plan',
      'apply-result',
      'tools/learning-inbox-review.test.js',
    ]);
    expectAll(reference, [
      'multiple reviews are overdue',
      'diagnostic catch-up question',
      'decayed score',
      'mobile',
      'one weak point',
      'boundary',
      'counterexample',
      'fresh 1/3/7/14/30 pending queue',
      '`partial` and `prompted` are not wrong answers',
    ]);
  });

  test('catch-up review trigger query discovers jack-learning-inbox first', () => {
    const results = searchHermesSkills({
      query: '假如已经 N 天后 测试复习流程 找不合理',
      manifestPath: '/Users/jack/1_learn/00_DIM/hermes-skills/manifest.json',
      limit: 3,
    });

    expect(results[0]?.id).toBe('jack-learning-inbox');
  });

  test('learning engine delegates details instead of duplicating the workflow body', () => {
    const engine = read(engineSkillPath);

    expect(engine).toContain('jack-learning-inbox');
    expect(engine).not.toContain('| source_conversation_cue | 可恢复上下文的一句话线索，不存整段 transcript |');
    expect(engine).not.toContain('```yaml\nlearning_inbox:');
    expect(engine).not.toContain('## 艾宾浩斯衰减机制');
    expect(engine).not.toContain('1-3天      → -5%');
    expect(engine).not.toContain('核心知识点衰减速度 ×0.7');
    expect(engine).not.toContain('first_learned_at + [1d, 3d, 7d, 14d, 30d]');
  });
});
