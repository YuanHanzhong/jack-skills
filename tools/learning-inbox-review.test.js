import { spawnSync } from 'child_process';
import { copyFileSync, mkdtempSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';
import {
  applyReviewResultToFile,
  dryRunFile,
  parseLearningInbox,
  planReview,
} from './learning-inbox-review.js';

const wrapperFallbackPath = '04_ADS/2_进行中/26-0510-05-learn-progress-learning-inbox-wrapper.md';

function read(path) {
  return readFileSync(path, 'utf8');
}

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'learning-inbox-review-'));
  const file = join(dir, '26-0510-05-learn-progress-learning-inbox-wrapper.md');
  copyFileSync(wrapperFallbackPath, file);
  return file;
}

function withMastery(content, score) {
  return content
    .replace(/^mastery_score:\s*\d+$/m, `mastery_score: ${score}`)
    .replace('| mastery_score | 88 |', `| mastery_score | ${score} |`);
}

function withFrontmatterField(content, field, value) {
  return content.replace(/^---\n/, `---\n${field}: ${value}\n`);
}

describe('learning-inbox review tool', () => {
  test('N=30 days with five pending reviews selects catch-up diagnosis instead of mechanical row replay', () => {
    const content = read(wrapperFallbackPath);
    const parsed = parseLearningInbox(content);
    const plan = planReview(content, { asOf: '2026-06-09T10:00:00+08:00' });

    expect(plan.mode).toBe('catch-up-diagnostic');
    expect(plan.overdueCount).toBe(5);
    expect(plan.selectedReviewIndex).toBeNull();
    expect(plan.selectedQuestion).not.toBe(parsed.reviews[0].question);
    expect(plan.reason).toContain('multiple overdue');
  });

  test('authority segmented decay uses last reviewed date with first learned or created fallback', () => {
    const content = read(wrapperFallbackPath);

    expect(planReview(content, { asOf: '2026-05-12T10:00:00+08:00' }).decayedScore).toBe(83);
    expect(planReview(content, { asOf: '2026-05-15T10:00:00+08:00' }).decayedScore).toBe(78);
    expect(planReview(content, { asOf: '2026-05-20T10:00:00+08:00' }).decayedScore).toBe(68);
    expect(planReview(content, { asOf: '2026-06-09T10:00:00+08:00' }).decayedScore).toBe(58);

    const reviewedRecently = withFrontmatterField(content, 'last_reviewed_at', '2026-06-01T10:00:00+08:00');
    expect(planReview(reviewedRecently, { asOf: '2026-06-09T10:00:00+08:00' }).decayedScore).toBe(68);
  });

  test('core learning point uses seventy percent of the segmented decay', () => {
    const content = withFrontmatterField(read(wrapperFallbackPath), 'core', 'true');

    expect(planReview(content, { asOf: '2026-06-09T10:00:00+08:00' }).decayedScore).toBe(67);
  });

  test('decayed score chooses L1, L2, or L3 review depth by authority thresholds', () => {
    const content = read(wrapperFallbackPath);
    const l1Plan = planReview(content, { asOf: '2026-06-09T10:00:00+08:00' });
    const l2Plan = planReview(withMastery(content, 70), { asOf: '2026-05-10T10:00:00+08:00' });
    const l3Plan = planReview(withMastery(content, 90), { asOf: '2026-05-10T10:00:00+08:00' });

    expect(l1Plan.level).toBe('L1');
    expect(l1Plan.weakPoint).toBe('concept_essence');
    expect(l2Plan.level).toBe('L2');
    expect(l2Plan.weakPoint).toBe('local_application');
    expect(l2Plan.selectedQuestion).toContain('系统里的 wrapper 场景');
    expect(l3Plan.level).toBe('L3');
    expect(l3Plan.weakPoint).toBe('boundary_counterexample');
    expect(l3Plan.selectedQuestion).toContain('边界场景');
  });

  test('correct official review consumes one due item and updates mastery counters', () => {
    const file = makeFixture();

    applyReviewResultToFile(file, {
      asOf: '2026-05-11T10:00:00+08:00',
      score: 91,
      quality: 'core_hit',
    });

    const parsed = parseLearningInbox(read(file));
    expect(parsed.frontmatter.mastery_score).toBe(91);
    expect(parsed.frontmatter.review_count).toBe(1);
    expect(parsed.frontmatter.consecutive_correct).toBe(1);
    expect(parsed.frontmatter.last_answer_quality).toBe('core_hit');
    expect(parsed.reviews[0].status).toBe('done');
    expect(parsed.reviews[1].status).toBe('pending');
  });

  test('official catch-up pass after multiple overdue reviews rebuilds a fresh 1/3/7/14/30 queue', () => {
    const file = makeFixture();

    applyReviewResultToFile(file, {
      asOf: '2026-06-09T10:00:00+08:00',
      score: 91,
      quality: 'core_hit',
    });

    const content = read(file);
    const parsed = parseLearningInbox(content);
    expect(content).toContain('last_reviewed_at: 2026-06-09T10:00:00+08:00');
    expect(parsed.frontmatter.mastery_score).toBe(91);
    expect(parsed.frontmatter.consecutive_correct).toBe(1);
    expect(parsed.reviews.map((review) => review.status)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(parsed.reviews.map((review) => review.dueAt)).toEqual([
      '2026-06-10 09:00 +08:00',
      '2026-06-12 09:00 +08:00',
      '2026-06-16 09:00 +08:00',
      '2026-06-23 09:00 +08:00',
      '2026-07-09 09:00 +08:00',
    ]);
    expect(parsed.reviews.some((review) => parseDateForTest(review.dueAt) < parseDateForTest('2026-06-09T10:00:00+08:00'))).toBe(false);
  });

  test('wrong or forgotten answer resets future schedule to a fresh 1/3/7/14/30 day queue', () => {
    const file = makeFixture();

    applyReviewResultToFile(file, {
      asOf: '2026-05-11T10:00:00+08:00',
      score: 40,
      quality: 'wrong',
    });

    const parsed = parseLearningInbox(read(file));
    expect(parsed.frontmatter.mastery_score).toBe(40);
    expect(parsed.frontmatter.review_count).toBe(1);
    expect(parsed.frontmatter.consecutive_correct).toBe(0);
    expect(parsed.frontmatter.last_answer_quality).toBe('wrong');
    expect(parsed.reviews.map((review) => review.status)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(parsed.reviews.map((review) => review.dueAt)).toEqual([
      '2026-05-12 09:00 +08:00',
      '2026-05-14 09:00 +08:00',
      '2026-05-18 09:00 +08:00',
      '2026-05-25 09:00 +08:00',
      '2026-06-10 09:00 +08:00',
    ]);
  });

  test('partial and prompted answers update fields without triggering a wrong-answer full reset', () => {
    for (const quality of ['partial', 'prompted']) {
      const file = makeFixture();
      const original = parseLearningInbox(read(file));

      applyReviewResultToFile(file, {
        asOf: '2026-05-11T10:00:00+08:00',
        score: quality === 'partial' ? 74 : 82,
        quality,
      });

      const content = read(file);
      const parsed = parseLearningInbox(content);
      expect(content).toContain('last_reviewed_at: 2026-05-11T10:00:00+08:00');
      expect(parsed.frontmatter.last_answer_quality).toBe(quality);
      expect(parsed.frontmatter.consecutive_correct).toBe(0);
      expect(parsed.reviews.map((review) => review.dueAt)).toEqual(original.reviews.map((review) => review.dueAt));
      expect(parsed.reviews.map((review) => review.status)).toEqual(original.reviews.map((review) => review.status));
    }
  });

  test('missing score exits nonzero and does not write the file', () => {
    const file = makeFixture();
    const before = read(file);

    const result = spawnSync(process.execPath, [
      'tools/learning-inbox-review.js',
      'apply-result',
      '--file',
      file,
      '--as-of',
      '2026-05-11T10:00:00+08:00',
      '--quality',
      'core_hit',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(read(file)).toBe(before);
    expect(result.stderr).toContain('score');
  });

  test('invalid quality exits nonzero and does not write the file', () => {
    const file = makeFixture();
    const before = read(file);

    const result = spawnSync(process.execPath, [
      'tools/learning-inbox-review.js',
      'apply-result',
      '--file',
      file,
      '--as-of',
      '2026-05-11T10:00:00+08:00',
      '--score',
      '91',
      '--quality',
      'correct',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(read(file)).toBe(before);
    expect(result.stderr).toContain('quality');
  });

  test('dry-run reads and plans without writing the fallback file', () => {
    const file = makeFixture();
    const before = read(file);
    const beforeMtime = statSync(file).mtimeMs;

    const plan = dryRunFile(file, { asOf: '2026-06-09T10:00:00+08:00' });

    expect(plan.write).toBe(false);
    expect(read(file)).toBe(before);
    expect(statSync(file).mtimeMs).toBe(beforeMtime);
  });

  test('mobile catch-up question targets one weak point in one short prompt', () => {
    const plan = planReview(read(wrapperFallbackPath), { asOf: '2026-06-09T10:00:00+08:00' });
    const sentenceCount = plan.selectedQuestion.split(/[。！？?]/).filter(Boolean).length;

    expect(plan.mobile.oneWeakPoint).toBe(true);
    expect(plan.mobile.shortPrompt).toBe(true);
    expect(plan.weakPoint).toBe('concept_essence');
    expect(sentenceCount).toBeLessThanOrEqual(3);
    expect(plan.selectedQuestion.length).toBeLessThanOrEqual(80);
    expect(plan.selectedQuestion).not.toMatch(/定义.*例子.*对比.*迁移/);
  });
});

function parseDateForTest(value) {
  return new Date(String(value).trim().replace(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([+-]\d{2}:?\d{2})$/,
    '$1T$2:00$3',
  ));
}
