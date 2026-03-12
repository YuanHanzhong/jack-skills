/**
 * ods_learning.ts — learning-engine Mode 6: Material-Based Learning (ODS Mode)
 * Spec: 26-0304-0955-ods-learning-spec
 *
 * Flow:
 *   Step 1: ODS archive (background, silent, incremental)
 *   Step 2: Probe test (3-5 flashcard-style questions)
 *   Step 3: Overview map (chat: compact tree; DWD: full toggle tree)
 *   Step 4: DWD document creation (see dwd_builder.ts)
 *   Step 5: User selects branch
 *   Step 6: Feynman coaching loop (scored by flashcard rubric)
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { resolve } from "../_shared/schema_resolver.ts";
import { TEMP_BASE } from "../_shared/paths.ts";
import { STATUS_MAP, MASTERY_UNTOUCHED, MASTERY_FAMILIAR, MASTERY_UNDERSTOOD, MASTERY_MASTERED, MASTERY_INTERNALIZED } from "../_shared/constants.ts";


const ODS_SESSION_DIR = join(TEMP_BASE, "ods_sessions");

// ── Scoring constants ────────────────────────────────────────────────────────

/** Score delta applied when a wrong answer is given. */
const SCORE_DELTA_WRONG = 10.0;
/** Score delta applied when a hint was needed. */
const SCORE_DELTA_HINTED = 25.0;
/** Score delta applied for a partial answer (gain). */
const SCORE_DELTA_PARTIAL = 5.0;
/** Score delta for the 1st consecutive correct answer. */
const SCORE_DELTA_CORRECT_1 = 10.0;
/** Score delta for the 2nd consecutive correct answer. */
const SCORE_DELTA_CORRECT_2 = 12.0;
/** Score delta for the 3rd consecutive correct answer. */
const SCORE_DELTA_CORRECT_3 = 8.0;
/** Score delta for the 4th+ consecutive correct answer. */
const SCORE_DELTA_CORRECT_4 = 5.0;

/** Score cap for partial answers (cannot reach "tested" band). */
const SCORE_CAP_PARTIAL = 74.0;
/** Score floor after the 1st correct (jump to at least this). */
const SCORE_FLOOR_CORRECT_1 = 60.0;
/** Score cap after the 1st consecutive correct. */
const SCORE_CAP_CORRECT_1 = 75.0;
/** Score cap after the 2nd consecutive correct. */
const SCORE_CAP_CORRECT_2 = 85.0;
/** Score cap after the 3rd consecutive correct. */
const SCORE_CAP_CORRECT_3 = 92.0;
/** Score cap after the 4th consecutive correct. */
const SCORE_CAP_CORRECT_4 = 94.0;
/** Score assigned after the 5th consecutive correct (internalization threshold). */
const SCORE_INTERNALIZED = 95.0;

/** Minimum consecutive correct streak to show celebration message. */
const MIN_STREAK_FOR_CELEBRATION = 3;

/** Score assigned to a probe "known" result. */
const PROBE_SCORE_KNOWN = 80.0;
/** Score assigned to a probe "partial" result. */
const PROBE_SCORE_PARTIAL = 40.0;

// ── KnowledgePoint ──────────────────────────────────────────────────────────

export interface KnowledgePointData {
  id: string;
  title: string;
  depth: number;
  status: string;
  score: number;
  lastTested: string | null;
  consecutiveCorrect: number;
  children: KnowledgePointData[];
}

export class KnowledgePoint {
  id: string;
  title: string;
  depth: number;
  status: string;
  score: number;
  lastTested: string | null;
  consecutiveCorrect: number;
  children: KnowledgePoint[];

  constructor(
    id: string,
    title: string,
    depth: number,
    status = "untouched",
    score = 0.0,
    lastTested: string | null = null,
    consecutiveCorrect = 0,
    children: KnowledgePoint[] = [],
  ) {
    this.id = id;
    this.title = title;
    this.depth = depth;
    this.status = status;
    this.score = score;
    this.lastTested = lastTested;
    this.consecutiveCorrect = consecutiveCorrect;
    this.children = children;
  }

  get statusEmoji(): string {
    return STATUS_MAP[this.status] ?? "⬜";
  }

  toSummaryRow(): Record<string, string> {
    return {
      status: this.statusEmoji,
      name: this.title,
      score: `${this.score.toFixed(0)}%`,
      last_tested: this.lastTested ?? "—",
    };
  }
}

// ── KnowledgePoint serialization helpers ─────────────────────────────────────

export function _kpToDict(kp: KnowledgePoint): KnowledgePointData {
  return {
    id: kp.id,
    title: kp.title,
    depth: kp.depth,
    status: kp.status,
    score: kp.score,
    lastTested: kp.lastTested,
    consecutiveCorrect: kp.consecutiveCorrect,
    children: kp.children.map(_kpToDict),
  };
}

export function _kpFromDict(d: KnowledgePointData): KnowledgePoint {
  const kp = new KnowledgePoint(
    d.id,
    d.title,
    d.depth ?? 1,
    d.status ?? "untouched",
    d.score ?? 0.0,
    d.lastTested ?? null,
    d.consecutiveCorrect ?? 0,
  );
  kp.children = (d.children ?? []).map(_kpFromDict);
  return kp;
}

// ── MaterialSession ─────────────────────────────────────────────────────────

export class MaterialSession {
  materialId: string;
  sourceUrl: string;
  sourceSummary: string;
  title: string;
  rawText: string;
  knowledgeTree: KnowledgePoint[];
  totalPoints: number;
  learnedCount: number;
  unlearnedCount: number;
  odsWriteCursor: number;
  odsTotalChunks: number;
  odsComplete: boolean;
  dwdPageId: string | null;
  odsPageId: string | null;
  createdAt: string;
  pendingBranches: string[];

  constructor(
    materialId: string,
    sourceUrl: string,
    sourceSummary: string,
    title: string,
    rawText = "",
  ) {
    this.materialId = materialId;
    this.sourceUrl = sourceUrl;
    this.sourceSummary = sourceSummary;
    this.title = title;
    this.rawText = rawText;
    this.knowledgeTree = [];
    this.totalPoints = 0;
    this.learnedCount = 0;
    this.unlearnedCount = 0;
    this.odsWriteCursor = 0;
    this.odsTotalChunks = 0;
    this.odsComplete = false;
    this.dwdPageId = null;
    this.odsPageId = null;
    this.createdAt = new Date().toLocaleString("sv-SE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    this.pendingBranches = [];
  }

  toDict(): Record<string, unknown> {
    const d: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this)) {
      if (k !== "knowledgeTree") d[k] = v;
    }
    d.knowledgeTree = this.knowledgeTree.map(_kpToDict);
    return d;
  }

  static async load(materialId: string): Promise<MaterialSession | null> {
    const p = join(ODS_SESSION_DIR, `${materialId}.json`);
    try {
      const text = await Bun.file(p).text();
      const d = JSON.parse(text) as Record<string, any>;
      const s = new MaterialSession(
        d.materialId,
        d.sourceUrl ?? "",
        d.sourceSummary ?? "",
        d.title ?? "",
        d.rawText ?? "",
      );
      for (const [k, v] of Object.entries(d)) {
        if (k !== "knowledgeTree" && k in s) {
          (s as unknown as Record<string, unknown>)[k] = v;
        }
      }
      s.knowledgeTree = (d.knowledgeTree ?? []).map(_kpFromDict);
      return s;
    } catch (e) {
      console.warn("[ods_learning] session load failed:", e);
      return null;
    }
  }

  async save(): Promise<void> {
    await mkdir(ODS_SESSION_DIR, { recursive: true });
    const p = join(ODS_SESSION_DIR, `${this.materialId}.json`);
    await Bun.write(p, JSON.stringify(this.toDict(), null, 2));
  }
}

// ── makeMaterialId ──────────────────────────────────────────────────────────

export function makeMaterialId(sourceUrl: string, textPreview = ""): string {
  const raw = sourceUrl || textPreview;
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(raw);
  return hasher.digest("hex").slice(0, 12);
}

// ── isMaterialModeTrigger ───────────────────────────────────────────────────

export function isMaterialModeTrigger(userMessage: string): boolean {
  const msg = userMessage.trim();
  const keywords = [
    "帮我学", "学这", "分析这", "分析一下", "解读", "拆解",
    "学习这", "读这", "看这", "这段内容", "这篇", "这段材料",
    "视频字幕", "文章", "论文", "帮我理解",
  ];
  return keywords.some((kw) => msg.includes(kw));
}

// ── Step 1: ODS Archive ─────────────────────────────────────────────────────

const CHUNK_MIN_CHARS = 200;
const CHUNK_MAX_CHARS = 1800;

export function splitTextIntoChunks(fullText: string): string[] {
  if (!fullText || !fullText.trim()) return [];

  // Step 1: split on blank lines
  const rawParas = fullText
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Step 2: merge short paragraphs
  const merged: string[] = [];
  let buffer = "";
  for (const para of rawParas) {
    buffer = buffer ? buffer + "\n\n" + para : para;
    if (buffer.length >= CHUNK_MIN_CHARS) {
      merged.push(buffer);
      buffer = "";
    }
  }
  if (buffer) merged.push(buffer);

  // Step 3: split oversized chunks at sentence boundary
  const chunks: string[] = [];
  const sentenceEnd = /(?<=[。！？.!?])\s*/;
  for (const chunk of merged) {
    if (chunk.length <= CHUNK_MAX_CHARS) {
      chunks.push(chunk);
    } else {
      const sentences = chunk.split(sentenceEnd);
      let current = "";
      for (const sent of sentences) {
        if (current.length + sent.length <= CHUNK_MAX_CHARS) {
          current += sent;
        } else {
          if (current) chunks.push(current.trim());
          current = sent;
        }
      }
      if (current.trim()) chunks.push(current.trim());
    }
  }

  return chunks;
}

export function buildOdsContent(
  sourceUrl: string,
  fullText: string,
  summary = "",
): string {
  const now = new Date().toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts: string[] = [
    "# 📥 原始资料存档\n",
    `> 🔖 存档时间：${now}`,
    `> 📌 来源：${sourceUrl || "（用户粘贴）"}`,
    "",
    "## 📄 原始全文\n",
    fullText && fullText.trim() ? fullText.trim() : "（原文未提供）",
    "",
  ];
  if (summary && summary.trim()) {
    parts.push("## 📝 摘要（补充·Claude生成）\n", summary.trim(), "");
  }
  return parts.join("\n");
}

export function buildOdsContentFromSession(session: MaterialSession): string {
  return buildOdsContent(
    session.sourceUrl,
    session.rawText,
    session.sourceSummary,
  );
}

export interface WriteChunkResult {
  status: string;
  cursor?: number;
  total?: number;
  remaining?: number;
  chunk?: string;
  progressLabel?: string;
  reason?: string;
  hint?: string;
}

export async function writeNextOdsChunk(
  session: MaterialSession,
  chunks?: string[],
): Promise<WriteChunkResult> {
  if (session.odsComplete) {
    return { status: "already_complete" };
  }

  if (chunks === undefined) {
    if (!session.rawText || !session.rawText.trim()) {
      return {
        status: "error",
        reason:
          "raw_text is empty — ODS cannot be written without original text",
        hint: "Set session.rawText before calling writeNextOdsChunk()",
      };
    }
    chunks = splitTextIntoChunks(session.rawText);
    if (session.odsTotalChunks === 0) {
      session.odsTotalChunks = chunks.length;
    }
  }

  if (!chunks.length || session.odsWriteCursor >= chunks.length) {
    session.odsComplete = true;
    await session.save();
    return { status: "complete" };
  }

  const chunk = chunks[session.odsWriteCursor];
  session.odsWriteCursor += 1;
  await session.save();
  const remaining = chunks.length - session.odsWriteCursor;
  return {
    status: "in_progress",
    cursor: session.odsWriteCursor,
    total: chunks.length,
    remaining,
    chunk,
    progressLabel: `[ODS写入: ${session.odsWriteCursor}/${chunks.length}]`,
  };
}

// ── ADS Update Payload ──────────────────────────────────────────────────────

export function buildAdsUpdatePayload(
  score: number,
  consecutiveCorrect: number,
  testDate: string,
): Record<string, unknown> {
  let level: string;
  if (score === 0) level = MASTERY_UNTOUCHED;
  else if (score < 50) level = MASTERY_FAMILIAR;
  else if (score < 85) level = MASTERY_UNDERSTOOD;
  else if (score < 95) level = MASTERY_MASTERED;
  else if (score >= 95 && consecutiveCorrect >= 5) level = MASTERY_INTERNALIZED;
  else level = MASTERY_MASTERED;

  return {
    [resolve("ADS", "mastery")]: { select: { name: level } },
    [resolve("ADS", "masteryScore")]: { number: Math.round(score * 10) / 10 },
    [resolve("ADS", "lastTestDate")]: { date: { start: testDate } },
    [resolve("ADS", "streakCorrect")]: { number: consecutiveCorrect },
  };
}

// ── Step 2: Probe Test ──────────────────────────────────────────────────────

export function buildProbeQuestions(
  knowledgePoints: KnowledgePoint[],
  count = 4,
): Array<Record<string, unknown>> {
  const flat = _flattenPoints(knowledgePoints);
  const selected = flat.slice(0, count);
  return selected.map((kp, i) => ({
    number: i + 1,
    kp_id: kp.id,
    kp_title: kp.title,
    question: `用一句话解释：${_stripEmoji(kp.title)}`,
    type: "quick_answer",
  }));
}

export function markProbeResults(
  knowledgePoints: KnowledgePoint[],
  results: Record<string, string>,
): KnowledgePoint[] {
  const flat = _flattenPoints(knowledgePoints);
  for (const kp of flat) {
    const result = results[kp.id];
    if (result === "known") {
      kp.status = "mastered";
      kp.score = PROBE_SCORE_KNOWN;
    } else if (result === "partial") {
      kp.status = "learning";
      kp.score = PROBE_SCORE_PARTIAL;
    }
  }
  return flat;
}

// ── Step 3: Overview Map ────────────────────────────────────────────────────

export function buildCompactOverview(
  title: string,
  chapters: KnowledgePoint[],
  probeResults: Record<string, string>,
  userContext = "",
): string {
  const lines: string[] = [
    "❓ 你对哪个部分最好奇？（说出章节名或编号，我们从那里开始）",
    "",
    `📚 ${title}`,
  ];
  const chs = chapters.slice(0, 7);
  for (let idx = 0; idx < chs.length; idx++) {
    const ch = chs[idx];
    const s = _probeEmoji(ch, probeResults);
    const icon = ch.depth === 1 && idx < 2 ? "🔥" : "💡";
    lines.push(`├── ${icon} ${ch.title} ${s}`);
    const visibleChildren = ch.children.slice(0, 3);
    for (let j = 0; j < visibleChildren.length; j++) {
      const child = visibleChildren[j];
      const isLast = j === visibleChildren.length - 1;
      const prefix = isLast ? "└──" : "├──";
      const cs = _probeEmoji(child, probeResults);
      const suspense = _suspense(child, userContext);
      lines.push(
        `│   ${prefix} ${cs} ${_stripEmoji(child.title)} — 「${suspense}」`,
      );
    }
    if (ch.children.length > 3) {
      lines.push(`│   └── ... 共${ch.children.length}个知识点`);
    }
  }
  lines.push("", "📌 ⬜未接触  ✅已掌握  🔵了解中  🟡测试过  🔴需复习");
  return lines.join("\n");
}

// ── Step 5: Branch Selection ────────────────────────────────────────────────

export function parseBranchSelection(
  userMsg: string,
  chapters: KnowledgePoint[],
): KnowledgePoint | null {
  const msg = userMsg.trim().toLowerCase();
  for (const ch of chapters) {
    if (_stripEmoji(ch.title).toLowerCase().includes(msg) || msg.includes(_stripEmoji(ch.title).toLowerCase())) {
      return ch;
    }
    for (const child of ch.children) {
      if (_stripEmoji(child.title).toLowerCase().includes(msg) || msg.includes(_stripEmoji(child.title).toLowerCase())) {
        return child;
      }
    }
  }
  return null;
}

export function getPendingBranches(chapters: KnowledgePoint[]): KnowledgePoint[] {
  return chapters.filter(
    (ch) => ch.status === "untouched" || ch.status === "learning",
  );
}

// ── Step 6: Flashcard Scoring ───────────────────────────────────────────────

export function calculateNewScore(
  currentScore: number,
  consecutiveCorrect: number,
  answerResult: string,
): [number, number] {
  if (answerResult === "wrong") {
    return [Math.max(0.0, currentScore - SCORE_DELTA_WRONG), 0];
  }
  if (answerResult === "hinted") {
    return [Math.max(0.0, currentScore - SCORE_DELTA_HINTED), 0];
  }
  if (answerResult === "partial") {
    return [Math.min(currentScore + SCORE_DELTA_PARTIAL, SCORE_CAP_PARTIAL), consecutiveCorrect];
  }
  // correct
  const n = consecutiveCorrect + 1;
  let score: number;
  if (n === 1) score = Math.min(Math.max(currentScore, SCORE_FLOOR_CORRECT_1) + SCORE_DELTA_CORRECT_1, SCORE_CAP_CORRECT_1);
  else if (n === 2) score = Math.min(currentScore + SCORE_DELTA_CORRECT_2, SCORE_CAP_CORRECT_2);
  else if (n === 3) score = Math.min(currentScore + SCORE_DELTA_CORRECT_3, SCORE_CAP_CORRECT_3);
  else if (n === 4) score = Math.min(currentScore + SCORE_DELTA_CORRECT_4, SCORE_CAP_CORRECT_4);
  else score = SCORE_INTERNALIZED;
  return [score, n];
}

export function scoreToStatus(score: number, consecutive: number): string {
  if (score === 0) return "untouched";
  if (score < 50) return "learning";
  if (score < 85) return "tested";
  if (score >= 95 && consecutive >= 5) return "internalized";
  if (score >= 85) return "mastered";
  return "tested";
}

export function statusToEmoji(status: string): string {
  return STATUS_MAP[status] ?? "⬜";
}

export function buildScoreFeedback(
  kpTitle: string,
  oldScore: number,
  newScore: number,
  answerResult: string,
  consecutive: number,
): string {
  const delta = newScore - oldScore;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(0)}%` : `${delta.toFixed(0)}%`;
  const icon =
    answerResult === "correct" ? "✅" : answerResult === "partial" ? "⚠️" : "❌";
  const lines: string[] = [
    `> ${icon} **${kpTitle}**：${answerResult} → ${oldScore.toFixed(0)}% → **${newScore.toFixed(0)}%**（${deltaStr}）`,
    "",
  ];
  if (answerResult === "correct" && consecutive >= MIN_STREAK_FOR_CELEBRATION) {
    lines.push(`>> 🏆 连续答对${consecutive}次，掌握度稳步提升`, "");
  } else if (answerResult === "hinted") {
    lines.push(">> ⚠️ 提示后才想起，扣25%，标记重点复习", "");
  } else if (answerResult === "wrong") {
    lines.push(">> ❌ 连续计数清零，建议重新学习此知识点", "");
  }
  return lines.join("\n");
}

// ── Pending Branches Auto-Recommend ─────────────────────────────────────────

export function buildPendingRecommendation(session: MaterialSession): string {
  if (!session.pendingBranches.length) return "";
  const items = session.pendingBranches.slice(0, 3);
  const lines = ["📋 还有以下分支未学，下次可继续："];
  for (let i = 0; i < items.length; i++) {
    lines.push(`  ${i + 1}. ⬜ ${items[i]}`);
  }
  return lines.join("\n");
}

// ── Utilities ───────────────────────────────────────────────────────────────

export function _flattenPoints(chapters: KnowledgePoint[]): KnowledgePoint[] {
  const result: KnowledgePoint[] = [];
  for (const ch of chapters) {
    result.push(ch);
    result.push(..._flattenPoints(ch.children));
  }
  return result;
}

export function _stripEmoji(text: string): string {
  return text
    .replace(
      /[\u{10000}-\u{10FFFF}\u2600-\u27FF\u2B50\u2B55]/gu,
      "",
    )
    .trim();
}

export function _probeEmoji(
  kp: KnowledgePoint,
  probeResults: Record<string, string>,
): string {
  const result = probeResults[kp.id] ?? "blank";
  const PROBE_MAP: Record<string, string> = {
    known: STATUS_MAP.mastered,
    partial: STATUS_MAP.learning,
    blank: STATUS_MAP.untouched,
  };
  return PROBE_MAP[result] ?? STATUS_MAP.untouched;
}

export function _suspense(kp: KnowledgePoint, userContext = ""): string {
  const title = _stripEmoji(kp.title);
  if (userContext && userContext.length > 10) {
    return `这个对你的${userContext.slice(0, 8)}有什么用？`;
  }
  return `如果不知道「${title}」会怎样？`;
}

// ── Tests ───────────────────────────────────────────────────────────────────

import { describe, test, expect } from "bun:test";

describe("ODSLearning", () => {
  test("isMaterialModeTrigger", () => {
    expect(isMaterialModeTrigger("帮我学这段视频字幕")).toBe(true);
    expect(isMaterialModeTrigger("分析这段内容")).toBe(true);
    expect(isMaterialModeTrigger("复习一下")).toBe(false);
    expect(isMaterialModeTrigger("测试我")).toBe(false);
  });

  test("score correct consecutive", () => {
    let [s, c] = calculateNewScore(0.0, 0, "correct");
    expect(s).toBeGreaterThanOrEqual(60.0);
    expect(c).toBe(1);
    let [s2, c2] = calculateNewScore(s, c, "correct");
    let [s3, c3] = calculateNewScore(s2, c2, "correct");
    expect(s3).toBeGreaterThanOrEqual(90.0);
  });

  test("score wrong resets", () => {
    const [s, c] = calculateNewScore(80.0, 3, "wrong");
    expect(c).toBe(0);
    expect(s).toBeLessThan(80.0);
  });

  test("score hinted deducts", () => {
    const [s, c] = calculateNewScore(70.0, 2, "hinted");
    expect(c).toBe(0);
    expect(s).toBeLessThanOrEqual(45.0);
  });

  test("five consecutive mastered", () => {
    let score = 0.0;
    let cons = 0;
    for (let i = 0; i < 5; i++) {
      [score, cons] = calculateNewScore(score, cons, "correct");
    }
    expect(score).toBe(95.0);
    expect(cons).toBe(5);
  });

  test("status mapping", () => {
    expect(scoreToStatus(0.0, 0)).toBe("untouched");
    expect(scoreToStatus(95.0, 5)).toBe("internalized");
    expect(scoreToStatus(90.0, 3)).toBe("mastered");
    expect(scoreToStatus(30.0, 0)).toBe("learning");
  });

  test("ods content build", () => {
    const content = buildOdsContent(
      "https://youtu.be/abc",
      "费曼学习法介绍",
    );
    expect(content).toContain("费曼学习法介绍");
    expect(content).toContain("https://youtu.be/abc");
  });

  test("compact overview has hook", () => {
    const kp1 = new KnowledgePoint("1", "📌 费曼技巧", 1);
    const kp2 = new KnowledgePoint("2", "💡 输出代替输入", 1);
    kp1.children = [new KnowledgePoint("1.1", "🔹 核心定义", 2)];
    const overview = buildCompactOverview("测试视频", [kp1, kp2], {});
    expect(overview).toContain("你对哪个部分最好奇");
    expect(overview).toContain("测试视频");
  });

  test("material session save/load", async () => {
    const sid = "test_abc123";
    const session = new MaterialSession(
      sid,
      "https://test.com",
      "测试摘要",
      "测试材料",
    );
    session.odsTotalChunks = 5;
    await session.save();
    const loaded = await MaterialSession.load(sid);
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe("测试材料");
    expect(loaded!.odsTotalChunks).toBe(5);
  });

  test("splitTextIntoChunks empty", () => {
    expect(splitTextIntoChunks("")).toEqual([]);
  });

  test("splitTextIntoChunks basic", () => {
    const text =
      "第一段内容，这是一些文字。\n\n第二段内容，另外一些文字。\n\n第三段。";
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(0);
    const joined = chunks.join("\n\n");
    expect(joined).toContain("第一段");
    expect(joined).toContain("第二段");
    expect(joined).toContain("第三段");
  });

  test("splitTextIntoChunks max size", () => {
    const longPara = "句子测试。".repeat(400);
    const chunks = splitTextIntoChunks(longPara);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS + 50);
    }
  });

  test("buildOdsContentFromSession fulltext before summary", () => {
    const session = new MaterialSession(
      "ts",
      "https://t.com",
      "摘要内容",
      "T",
      "这是原始全文内容",
    );
    const content = buildOdsContentFromSession(session);
    expect(content).toContain("这是原始全文内容");
    expect(content).toContain("摘要内容");
    expect(content.indexOf("这是原始全文内容")).toBeLessThan(
      content.indexOf("摘要内容"),
    );
  });

  test("buildAdsUpdatePayload levels", () => {
    const cases: [number, number, string][] = [
      [0.0, 0, "⚪未学习"],
      [30.0, 1, "🟡了解中"],
      [70.0, 2, "🔵理解中"],
      [88.0, 3, "🟢已掌握"],
      [95.0, 5, "🟣已内化"],
    ];
    for (const [score, cons, expected] of cases) {
      const payload = buildAdsUpdatePayload(score, cons, "2026-03-04");
      expect((payload["掌握度"] as any).select.name).toBe(expected);
    }
  });

  test("kp roundtrip with children", () => {
    const kp = new KnowledgePoint(
      "k1",
      "📌 测试",
      2,
      "mastered",
      85.0,
      "03-04",
      3,
    );
    const child = new KnowledgePoint("k1.1", "子节点", 3, "untouched", 50.0);
    kp.children = [child];
    const d = _kpToDict(kp);
    const restored = _kpFromDict(d);
    expect(restored.id).toBe("k1");
    expect(restored.score).toBe(85.0);
    expect(restored.children.length).toBe(1);
    expect(restored.children[0].id).toBe("k1.1");
  });

  test("statusToEmoji all", () => {
    for (const [status, emoji] of Object.entries(STATUS_MAP)) {
      expect(statusToEmoji(status)).toBe(emoji);
    }
    expect(statusToEmoji("unknown")).toBe("⬜");
  });

  test("writeNextOdsChunk empty raw text", async () => {
    const s = new MaterialSession("err", "", "", "", "");
    const r = await writeNextOdsChunk(s);
    expect(r.status).toBe("error");
  });

  test("writeNextOdsChunk auto splits", async () => {
    const raw = "第一段落，内容在这里。\n\n第二段落，更多内容。";
    const s = new MaterialSession("auto", "", "", "", raw);
    const r = await writeNextOdsChunk(s);
    expect(["in_progress", "complete"]).toContain(r.status);
  });

  test("makeMaterialId no collision", () => {
    const id1 = makeMaterialId("", "a".repeat(40) + "DIFF1");
    const id2 = makeMaterialId("", "a".repeat(40) + "DIFF2");
    expect(id1).not.toBe(id2);
  });

  test("kp internalized emoji", () => {
    const kp = new KnowledgePoint("x", "t", 1, "internalized");
    expect(kp.statusEmoji).toBe("🟣");
  });

  test("incremental write", async () => {
    const session = new MaterialSession("write_test", "", "", "");
    const chunks = ["chunk1", "chunk2", "chunk3"];
    session.odsTotalChunks = chunks.length;
    const r1 = await writeNextOdsChunk(session, chunks);
    expect(r1.status).toBe("in_progress");
    expect(r1.cursor).toBe(1);
    await writeNextOdsChunk(session, chunks);
    await writeNextOdsChunk(session, chunks);
    const r4 = await writeNextOdsChunk(session, chunks);
    expect(r4.status).toBe("complete");
  });
});
