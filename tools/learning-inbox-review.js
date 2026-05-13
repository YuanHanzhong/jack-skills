import { readFileSync, writeFileSync } from 'fs';
import matter from 'gray-matter';

const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30];
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const ALLOWED_QUALITIES = new Set(['core_hit', 'partial', 'prompted', 'wrong', 'forgot', 'forgotten']);
const WRONG_QUALITIES = new Set(['wrong', 'forgot', 'forgotten']);

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(Number(score))));
}

function normalizeScore(score) {
  if (score === undefined || score === null || String(score).trim() === '') {
    throw new Error('Missing score: expected a 0-100 number');
  }
  const numeric = Number(score);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    throw new Error(`Invalid score: ${score}. Expected a 0-100 number`);
  }
  return Math.round(numeric);
}

function normalizeQuality(quality) {
  const normalized = String(quality || '').trim();
  if (!ALLOWED_QUALITIES.has(normalized)) {
    throw new Error(`Invalid quality: ${quality || '(missing)'}. Expected one of ${Array.from(ALLOWED_QUALITIES).join(', ')}`);
  }
  return normalized;
}

function parseDate(value) {
  if (value instanceof Date) return value;
  const normalized = String(value).trim().replace(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([+-]\d{2}:?\d{2})$/,
    '$1T$2:00$3',
  );
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

function shanghaiDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function shanghaiDateAtNine(baseDate, plusDays) {
  const parts = shanghaiDateParts(baseDate);
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) + plusDays,
    1,
    0,
    0,
  ));
}

function formatShanghaiDueAt(date) {
  const parts = shanghaiDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} +08:00`;
}

function splitMarkdownTableRow(line) {
  return line.trim().slice(1, -1).split('|').map((cell) => cell.trim());
}

function extractReviewTable(markdown) {
  const heading = '## 艾宾浩斯复习排期';
  const start = markdown.indexOf(heading);
  if (start < 0) {
    throw new Error('Missing review schedule section');
  }

  const nextHeading = markdown.indexOf('\n## ', start + heading.length);
  const section = markdown.slice(start, nextHeading >= 0 ? nextHeading : undefined);
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !/^\|\s*-+/.test(line))
    .slice(1)
    .map((line) => {
      const [index, dueAt, status, question] = splitMarkdownTableRow(line);
      return {
        index: Number(index),
        dueAt,
        status,
        question,
      };
    })
    .filter((row) => Number.isFinite(row.index));
}

function extractRecordFields(markdown) {
  const heading = '## 学习收件箱记录';
  const start = markdown.indexOf(heading);
  if (start < 0) return {};

  const nextHeading = markdown.indexOf('\n## ', start + heading.length);
  const section = markdown.slice(start, nextHeading >= 0 ? nextHeading : undefined);
  const entries = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !/^\|\s*-+/.test(line))
    .slice(1)
    .map((line) => splitMarkdownTableRow(line))
    .filter((cells) => cells.length >= 2);

  return Object.fromEntries(entries.map(([field, value]) => [field, value]));
}

export function parseLearningInbox(markdown) {
  const parsed = matter(markdown);
  return {
    frontmatter: parsed.data,
    body: parsed.content,
    record: extractRecordFields(parsed.content),
    reviews: extractReviewTable(parsed.content),
  };
}

function pendingReviews(reviews) {
  return reviews.filter((review) => review.status === 'pending');
}

function overduePendingReviews(reviews, asOfDate) {
  return pendingReviews(reviews)
    .filter((review) => parseDate(review.dueAt).getTime() <= asOfDate.getTime())
    .sort((a, b) => parseDate(a.dueAt).getTime() - parseDate(b.dueAt).getTime());
}

function levelForScore(score) {
  if (score >= 85) return 'L3';
  if (score >= 65) return 'L2';
  return 'L1';
}

function questionForLevel(concept, level) {
  if (level === 'L3') {
    return {
      weakPoint: 'boundary_counterexample',
      selectedQuestion: `只说一个 ${concept} 不适用或会误导的边界场景。`,
    };
  }
  if (level === 'L2') {
    return {
      weakPoint: 'local_application',
      selectedQuestion: `举一个你系统里的 ${concept} 场景，只说它解决的一处复杂度。`,
    };
  }
  return {
    weakPoint: 'concept_essence',
    selectedQuestion: `用一句话说出 ${concept} 的本质，不要举例。`,
  };
}

function mobileCheck(question) {
  const sentenceCount = question.split(/[。！？?]/).filter(Boolean).length;
  return {
    oneWeakPoint: true,
    shortPrompt: question.length <= 80 && sentenceCount <= 3,
  };
}

function valueForField(parsed, field) {
  return parsed.frontmatter[field] ?? parsed.record[field] ?? null;
}

function decayAnchorDate(parsed) {
  const value = valueForField(parsed, 'last_reviewed_at')
    || valueForField(parsed, 'first_learned_at')
    || valueForField(parsed, 'created_at');
  if (!value) {
    throw new Error('Missing review decay anchor: expected last_reviewed_at, first_learned_at, or created_at');
  }
  return parseDate(value);
}

function isCoreKnowledge(parsed) {
  const value = valueForField(parsed, 'core');
  return value === true || String(value).trim().toLowerCase() === 'true';
}

function decayPenalty(parsed, asOfDate) {
  const elapsedDays = (asOfDate.getTime() - decayAnchorDate(parsed).getTime()) / (1000 * 60 * 60 * 24);
  let penalty = 0;
  if (elapsedDays >= 14) penalty = 30;
  else if (elapsedDays >= 7) penalty = 20;
  else if (elapsedDays >= 3) penalty = 10;
  else if (elapsedDays >= 1) penalty = 5;

  return isCoreKnowledge(parsed) ? Math.round(penalty * 0.7) : penalty;
}

export function planReview(markdown, options = {}) {
  const parsed = parseLearningInbox(markdown);
  const asOfDate = parseDate(options.asOf || new Date());
  const overdue = overduePendingReviews(parsed.reviews, asOfDate);
  const pending = pendingReviews(parsed.reviews);
  const concept = parsed.frontmatter.concept || '这个概念';
  const masteryScore = clampScore(parsed.frontmatter.mastery_score || 0);
  const decayedScore = clampScore(masteryScore - decayPenalty(parsed, asOfDate));
  const level = levelForScore(decayedScore);
  const generated = questionForLevel(concept, level);
  const selectedReview = overdue[0] || pending[0] || null;
  const catchUp = overdue.length > 1;

  const selectedQuestion = generated.selectedQuestion;

  return {
    write: false,
    concept,
    masteryScore,
    decayedScore,
    level,
    mode: catchUp ? 'catch-up-diagnostic' : 'single-review',
    overdueCount: overdue.length,
    earliestDueAt: overdue[0]?.dueAt || null,
    latestDueAt: overdue.at(-1)?.dueAt || null,
    selectedReviewIndex: catchUp ? null : selectedReview?.index || null,
    selectedQuestion,
    weakPoint: generated.weakPoint,
    mobile: mobileCheck(selectedQuestion),
    reason: catchUp
      ? 'multiple overdue pending reviews; use one diagnostic catch-up question instead of replaying rows'
      : 'one due or upcoming review can be handled directly with decayed-score depth',
  };
}

function replaceFrontmatterField(markdown, field, value) {
  const end = markdown.indexOf('\n---', 4);
  if (!markdown.startsWith('---\n') || end < 0) {
    throw new Error('Missing frontmatter');
  }
  const head = markdown.slice(0, end);
  const rest = markdown.slice(end);
  const pattern = new RegExp(`(^${field}:\\s*).*$`, 'm');
  const rendered = typeof value === 'number' ? String(value) : String(value);
  if (pattern.test(head)) {
    return `${head.replace(pattern, `$1${rendered}`)}${rest}`;
  }
  return `${head}\n${field}: ${rendered}${rest}`;
}

function replaceRecordField(markdown, field, value) {
  const pattern = new RegExp(`(\\|\\s*${field}\\s*\\|\\s*)[^|\\n]+(\\s*\\|)`);
  return markdown.replace(pattern, `$1${value}$2`);
}

function renderReviewTable(reviews) {
  const rows = [
    '| 次数 | 到期时间 | 状态 | 复习题 |',
    '|---|---|---|---|',
    ...reviews.map((review) => `| ${review.index} | ${review.dueAt} | ${review.status} | ${review.question} |`),
  ];
  return rows.join('\n');
}

function replaceReviewSchedule(markdown, reviews) {
  const heading = '## 艾宾浩斯复习排期';
  const start = markdown.indexOf(heading);
  if (start < 0) {
    throw new Error('Missing review schedule section');
  }
  const nextHeading = markdown.indexOf('\n## ', start + heading.length);
  const replacement = `${heading}\n\n${renderReviewTable(reviews)}\n`;
  return `${markdown.slice(0, start)}${replacement}${nextHeading >= 0 ? markdown.slice(nextHeading) : ''}`;
}

function updateLearningFields(markdown, fields) {
  let updated = markdown;
  for (const [field, value] of Object.entries(fields)) {
    updated = replaceFrontmatterField(updated, field, value);
    updated = replaceRecordField(updated, field, value);
  }
  return updated;
}

function resetReviews(concept, asOfDate) {
  const questions = [
    `用一句话说出 ${concept} 的本质，不要举例。`,
    `举一个你系统里的 ${concept} 场景，只说它解决的一处复杂度。`,
    `${concept} 和相近做法最关键的一处差异是什么？`,
    `只说一个 ${concept} 不适用或会误导的边界场景。`,
    `把 ${concept} 迁移到一个新代码或命令场景，只说一个用法。`,
  ];

  return REVIEW_INTERVAL_DAYS.map((days, index) => ({
    index: index + 1,
    dueAt: formatShanghaiDueAt(shanghaiDateAtNine(asOfDate, days)),
    status: 'pending',
    question: questions[index],
  }));
}

export function applyReviewResult(markdown, options = {}) {
  const asOfInput = options.asOf || new Date();
  const asOfDate = parseDate(asOfInput);
  const reviewedAt = asOfInput instanceof Date ? asOfInput.toISOString() : String(asOfInput);
  const score = normalizeScore(options.score);
  const quality = normalizeQuality(options.quality);

  const parsed = parseLearningInbox(markdown);
  const concept = parsed.frontmatter.concept || '这个概念';
  const currentReviewCount = Number(parsed.frontmatter.review_count || 0);
  const currentConsecutiveCorrect = Number(parsed.frontmatter.consecutive_correct || 0);
  const passed = score >= 85 && !WRONG_QUALITIES.has(quality);
  const overdue = overduePendingReviews(parsed.reviews, asOfDate);
  let reviews = parsed.reviews;
  const fields = {
    mastery_score: score,
    review_count: currentReviewCount + 1,
    consecutive_correct: passed && quality === 'core_hit' ? currentConsecutiveCorrect + 1 : 0,
    last_answer_quality: quality,
    last_reviewed_at: reviewedAt,
  };

  if (WRONG_QUALITIES.has(quality)) {
    reviews = resetReviews(concept, asOfDate);
  } else if (passed && overdue.length > 1) {
    reviews = resetReviews(concept, asOfDate);
  } else if (passed) {
    const due = overdue[0] || pendingReviews(parsed.reviews)[0];
    if (!due) {
      throw new Error('No pending review to consume');
    }
    reviews = parsed.reviews.map((review) => (
      review.index === due.index ? { ...review, status: 'done' } : review
    ));
  }

  return replaceReviewSchedule(updateLearningFields(markdown, fields), reviews);
}

export function dryRunFile(filePath, options = {}) {
  return planReview(readFileSync(filePath, 'utf8'), options);
}

export function applyReviewResultToFile(filePath, options = {}) {
  const updated = applyReviewResult(readFileSync(filePath, 'utf8'), options);
  writeFileSync(filePath, updated, 'utf8');
  return parseLearningInbox(updated);
}

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function runCli(args) {
  const command = args[0];
  const file = option(args, '--file');
  if (!file || !command || ['plan', 'dry-run', 'apply-result'].includes(command) === false) {
    throw new Error('Usage: bun run tools/learning-inbox-review.js <plan|dry-run|apply-result> --file <path> [--as-of <date>] [--score <0-100> --quality <quality>]');
  }

  if (command === 'plan' || command === 'dry-run') {
    const plan = dryRunFile(file, { asOf: option(args, '--as-of', new Date()) });
    printJson(plan);
    return plan;
  }

  const result = applyReviewResultToFile(file, {
    asOf: option(args, '--as-of', new Date()),
    score: option(args, '--score'),
    quality: option(args, '--quality'),
  });
  printJson({ write: true, file, frontmatter: result.frontmatter, reviews: result.reviews });
  return result;
}

if (import.meta.main) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
