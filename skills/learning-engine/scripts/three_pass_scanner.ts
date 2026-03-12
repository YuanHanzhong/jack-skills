/**
 * three_pass_scanner.ts
 * ----------------------
 * Three-pass scanning protocol for long-document processing.
 *
 * Architecture: SubAgent isolation keeps main Agent context lightweight.
 *   Pass 1 (serial)   → rolling intent distillation → IntentMap (~1000 chars)
 *   Pass 2 (parallel) → knowledge extraction per chunk, anchored to IntentMap
 *   Pass 3 (parallel) → atomization into testable units with flashcard metadata
 *
 * The main Agent only ever holds JSON summaries; raw text lives only inside
 * short-lived SubAgent contexts and is discarded on SubAgent exit.
 */

// ── Data Structures ──────────────────────────────────────────────────────────

export interface IntentMap {
  version: number;
  coreThesis: string;         // Core proposition (1-2 sentences)
  logicChain: string[];       // Underlying logic A→B→C→D
  hiddenAssumptions: string[];// Implicit premises
  domainMap: Record<string, string[]>; // chapter → covered intents
  wordCount: number;
  createdAt: string;
}

export interface KnowledgePoint {
  id: string;
  title: string;
  intentRank: number;         // Which core intent this serves (sort key)
  intentRole: string;         // e.g. "证明A→C的关键步骤"
  sourceChapter: string;      // e.g. "第3章·第2节"
  level: "L1" | "L2" | "L3";
  atomic: boolean;
  content: string;            // Brief explanation (1-3 sentences)
  originalTerm?: string;      // Term as it appears in source material
}

export interface AtomicKnowledgePoint extends KnowledgePoint {
  atomic: true;
  // Flashcard state (stored in ADS record)
  status: "⬜" | "🔵" | "🟡" | "🟢" | "🔴";
  masteryScore: number;       // 0-100
  readCount: number;
  testCount: number;
  consecutiveCorrect: number;
  lastTested: string | null;
  nextReview: string | null;
}

export interface LearningArchiveState {
  materialTitle: string;
  phase: "pass1" | "pass2" | "pass3" | "done";
  pass1ChunkIndex: number;    // How many chunks pass1 has processed
  pass1TotalChunks: number;
  pass2ChunkIndex: number;    // How many chunks pass2 has processed
  pass3Done: boolean;
  intentMapVersion: number;
  dwdPageId: string | null;   // Notion DWD page ID once created
  lastUpdated: string;
}

// ── Chunk Utilities ──────────────────────────────────────────────────────────

/** Lines per chunk for SubAgent processing. 120 = unified standard (matches Read tool limit).
 *  Leaves buffer room so each SubAgent context isn't saturated by a single chunk. */
const CHUNK_SIZE_LINES = 120;

/**
 * Split raw text into ~120-line chunks.
 * Splits on blank lines near the boundary to avoid cutting mid-paragraph.
 */
export function splitIntoChunks(text: string, linesPerChunk = CHUNK_SIZE_LINES): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = Math.min(start + linesPerChunk, lines.length);
    // Try to break on a blank line near the target boundary
    if (end < lines.length) {
      for (let i = end; i > start + linesPerChunk * 0.8; i--) {
        if (lines[i].trim() === "") {
          end = i;
          break;
        }
      }
    }
    chunks.push(lines.slice(start, end).join("\n"));
    start = end;
  }
  return chunks;
}

// ── Pass 1: Rolling Intent Distillation ─────────────────────────────────────

/**
 * Build the SubAgent prompt for Pass 1.
 * Each invocation refines the intent hypothesis by reading one more chunk.
 *
 * @param currentIntent  JSON string of the current IntentMap (or null for first chunk)
 * @param newChunk       ~120-line raw text chunk
 * @param chunkIdx       0-based index of this chunk
 * @param totalChunks    Total number of chunks in the document
 */
export function buildRollingIntentPrompt(
  currentIntent: string | null,
  newChunk: string,
  chunkIdx: number,
  totalChunks: number,
): string {
  const isFirst = currentIntent === null;
  const priorSection = isFirst
    ? ""
    : `## Current Intent Hypothesis (v${chunkIdx})
\`\`\`json
${currentIntent}
\`\`\`

Based on this existing hypothesis, refine it with the new chunk below.
`;

  return `You are a reading comprehension specialist performing Pass 1 of a three-pass document scan.

Your task: extract and refine the author's **core intent** from this document chunk.
Chunk ${chunkIdx + 1} of ${totalChunks} (${Math.round(((chunkIdx + 1) / totalChunks) * 100)}% complete).

${priorSection}## New Chunk to Process
\`\`\`
${newChunk}
\`\`\`

## Output Requirements
Return ONLY a JSON object matching this TypeScript interface (no markdown, no explanation):

\`\`\`typescript
interface IntentMap {
  version: number;            // Increment from current version, start at 1
  coreThesis: string;         // Core proposition in 1-2 sentences, must be stable across chunks
  logicChain: string[];       // Underlying causal/logical chain, e.g. ["A→B", "B→C", "C→D"]
  hiddenAssumptions: string[];// Implicit premises the author relies on
  domainMap: Record<string, string[]>; // section/topic → which intents it serves
  wordCount: number;          // Cumulative word count processed so far
  createdAt: string;          // ISO timestamp
}
\`\`\`

Rules:
- coreThesis must be a HYPOTHESIS that gets refined each pass — it should stabilize across chunks
- logicChain items must be causal arrows (A→B format), 3-6 items
- hiddenAssumptions: implicit beliefs the argument depends on, 2-4 items
- domainMap keys = chapter/section names found in this chunk
- Do NOT include the raw text in output
- Output raw JSON only, no code fences
`;
}

// ── Pass 2: Knowledge Extraction ─────────────────────────────────────────────

/**
 * Build the SubAgent prompt for Pass 2.
 * IntentMap is injected as a fixed anchor to ensure knowledge points are
 * annotated with intentRank/intentRole rather than extracted blindly.
 */
export function buildKnowledgeExtractionPrompt(
  intentMap: IntentMap,
  chunk: string,
  chunkIdx: number,
): string {
  return `You are a knowledge extraction specialist performing Pass 2 of a three-pass document scan.

## Intent Anchor (fixed — do not modify)
\`\`\`json
${JSON.stringify(intentMap, null, 2)}
\`\`\`

## Chunk ${chunkIdx + 1} to Extract From
\`\`\`
${chunk}
\`\`\`

## Task
Extract all knowledge points from this chunk. Each knowledge point MUST be anchored
to the intent map above — this prevents decontextualized extraction.

## Output Format
Return a JSON array of KnowledgePoint objects. Output raw JSON array only, no code fences.

\`\`\`typescript
interface KnowledgePoint {
  id: string;           // "kp_{chunkIdx}_{i}", e.g. "kp_2_0"
  title: string;        // Concise title (≤10 Chinese characters or ≤6 English words)
  intentRank: number;   // Index (1-based) into intentMap.logicChain this KP supports
  intentRole: string;   // e.g. "证明A→C的关键步骤" or "支撑隐含假设2"
  sourceChapter: string;// Chapter/section identifier from this chunk
  level: "L1" | "L2" | "L3"; // L1=concept, L2=why/mechanism, L3=application
  atomic: false;        // Always false in Pass 2, atomization happens in Pass 3
  content: string;      // Brief explanation (1-3 sentences), NO raw text copy
  originalTerm?: string;// Term as it appears in the source material (if distinct from title)
}
\`\`\`

Rules:
- intentRank MUST reference a real index in intentMap.logicChain (use 1 if uncertain)
- Do NOT copy raw text into content — paraphrase or synthesize
- Minimum 3 knowledge points per chunk; maximum 15
- Output raw JSON array only
`;
}

// ── Pass 3: Atomization ──────────────────────────────────────────────────────

/**
 * Build the SubAgent prompt for Pass 3.
 * Takes a batch of KnowledgePoints and splits each into the smallest
 * independently testable unit, adding flashcard metadata.
 */
export function buildAtomizationPrompt(
  intentMap: IntentMap,
  kpList: KnowledgePoint[],
): string {
  return `You are an instructional design specialist performing Pass 3 of a three-pass document scan.

## Intent Anchor
\`\`\`json
${JSON.stringify({ coreThesis: intentMap.coreThesis, logicChain: intentMap.logicChain }, null, 2)}
\`\`\`

## Knowledge Points to Atomize
\`\`\`json
${JSON.stringify(kpList, null, 2)}
\`\`\`

## Task
Atomize each KnowledgePoint into the smallest independently testable unit.
A point is "atomic" if: one question tests exactly one concept, with no ambiguity about what's being asked.

## Output Format
Return a JSON array of AtomicKnowledgePoint objects. Output raw JSON array only, no code fences.

\`\`\`typescript
interface AtomicKnowledgePoint {
  id: string;                // Preserve or append "_a{i}" suffix, e.g. "kp_2_0_a0"
  title: string;
  intentRank: number;
  intentRole: string;
  sourceChapter: string;
  level: "L1" | "L2" | "L3";
  atomic: true;              // Always true in Pass 3
  content: string;
  originalTerm?: string;
  // Flashcard initial state (all new)
  status: "⬜";
  masteryScore: 0;
  readCount: 0;
  testCount: 0;
  consecutiveCorrect: 0;
  lastTested: null;
  nextReview: null;
}
\`\`\`

Rules:
- One KP may produce 1-3 atomic points (split complex concepts, keep simple ones as-is)
- Each atomic point must be independently testable
- Preserve intentRank and intentRole from the parent KP
- Sort output by intentRank ASC (most important intents first)
- Output raw JSON array only
`;
}

// ── Result Parsing ────────────────────────────────────────────────────────────

/**
 * Parse IntentMap from a SubAgent's raw text response.
 * Handles both raw JSON and JSON wrapped in code fences.
 */
export function parseIntentMapFromResponse(response: string): IntentMap {
  const cleaned = response
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed.coreThesis || !Array.isArray(parsed.logicChain)) {
    throw new Error("IntentMap missing required fields: coreThesis or logicChain");
  }
  return parsed as IntentMap;
}

/**
 * Parse a KnowledgePoint array from a SubAgent's raw text response.
 */
export function parseKnowledgePointsFromResponse(response: string): KnowledgePoint[] {
  const cleaned = response
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array of KnowledgePoints");
  }
  return parsed as KnowledgePoint[];
}

/**
 * Parse an AtomicKnowledgePoint array from a SubAgent's raw text response.
 */
export function parseAtomicKnowledgePointsFromResponse(response: string): AtomicKnowledgePoint[] {
  const parsed = parseKnowledgePointsFromResponse(response);
  return parsed as AtomicKnowledgePoint[];
}

// ── Merge & Dedup ─────────────────────────────────────────────────────────────

/**
 * Merge knowledge point lists from multiple parallel SubAgents.
 * Deduplication: if two points have identical title (normalized), keep the one
 * with more detail (longer content string).
 */
export function mergeKnowledgePoints(lists: KnowledgePoint[][]): KnowledgePoint[] {
  const flat = lists.flat();
  const seen = new Map<string, KnowledgePoint>();
  for (const kp of flat) {
    const key = kp.title.trim().toLowerCase().replace(/\s+/g, "");
    const existing = seen.get(key);
    if (!existing || kp.content.length > existing.content.length) {
      seen.set(key, kp);
    }
  }
  // Sort by intentRank ASC
  return Array.from(seen.values()).sort((a, b) => a.intentRank - b.intentRank);
}

// ── Panoramic Markdown Generator ─────────────────────────────────────────────

/**
 * Generate the user-visible panoramic map markdown for the DWD page top section.
 */
export function generatePanoramicMarkdown(
  materialTitle: string,
  intentMap: IntentMap,
  atomicPoints: AtomicKnowledgePoint[],
  env: "cli" | "cloud",
  createdAt: string,
): string {
  const lines: string[] = [];

  lines.push(`# 《${materialTitle}》学习档案`);
  lines.push(`> 创建：${createdAt} | 上次更新：${createdAt} | 环境：${env}`);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("## 🗺️ 全景地图");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");

  // Core intents
  lines.push("### 🧠 核心意图（按重要性排序）");
  lines.push(`**核心命题**：${intentMap.coreThesis}`);
  lines.push("");
  lines.push("**逻辑链**：");
  intentMap.logicChain.forEach((step, i) => {
    const count = atomicPoints.filter((p) => p.intentRank === i + 1).length;
    lines.push(`${i + 1}. ${step}（支撑：${count}个知识点）`);
  });
  lines.push("");

  if (intentMap.hiddenAssumptions.length > 0) {
    lines.push("**隐含假设**：");
    intentMap.hiddenAssumptions.forEach((a) => lines.push(`- ${a}`));
    lines.push("");
  }

  // Chapter coverage table
  const chapters = Object.keys(intentMap.domainMap);
  if (chapters.length > 0) {
    lines.push("### 📚 章节覆盖");
    lines.push("| 章节 | 知识点数 | 覆盖意图 | 掌握进度 |");
    lines.push("|------|---------|---------|---------|");
    for (const chapter of chapters) {
      const chapterPoints = atomicPoints.filter((p) => p.sourceChapter === chapter);
      const intents = intentMap.domainMap[chapter].join(", ");
      const statusBar = chapterPoints.slice(0, 8).map((p) => p.status).join("");
      lines.push(`| ${chapter} | ${chapterPoints.length} | ${intents} | ${statusBar} |`);
    }
    lines.push("");
  }

  // Overall progress
  const total = atomicPoints.length;
  const mastered = atomicPoints.filter((p) => p.masteryScore >= 85).length;
  const learning = atomicPoints.filter(
    (p) => p.masteryScore > 0 && p.masteryScore < 85,
  ).length;
  const untouched = atomicPoints.filter((p) => p.masteryScore === 0).length;

  lines.push("### 📊 总体进度");
  lines.push(
    `总计 **${total}** 个原子知识点 | 已掌握 **${mastered}** | 学习中 **${learning}** | 未接触 **${untouched}**`,
  );

  return lines.join("\n");
}

/**
 * Generate the system section markdown (folded callout, auto-maintained).
 */
export function generateSystemSectionMarkdown(
  state: LearningArchiveState,
  intentMap: IntentMap,
): string {
  const lines: string[] = [];
  lines.push("▶ ⚙️ 系统区（自动维护）");
  lines.push("");
  lines.push("  断点续传：");
  lines.push("  ```json");
  lines.push("  " + JSON.stringify(state, null, 2).replace(/\n/g, "\n  "));
  lines.push("  ```");
  lines.push("");
  lines.push(`  意图地图 v${intentMap.version}（${intentMap.createdAt}）：`);
  lines.push("  ```json");
  lines.push("  " + JSON.stringify(intentMap, null, 2).replace(/\n/g, "\n  "));
  lines.push("  ```");
  return lines.join("\n");
}

// ── Tests ────────────────────────────────────────────────────────────────────

import { describe, test, expect } from "bun:test";

describe("ThreePassScanner", () => {
  test("splitIntoChunks produces correct count", () => {
    const text = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
    const chunks = splitIntoChunks(text, 500);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.length).toBeGreaterThan(0);
    }
  });

  test("buildRollingIntentPrompt first chunk has no prior section", () => {
    const prompt = buildRollingIntentPrompt(null, "some text", 0, 5);
    expect(prompt).not.toContain("Current Intent Hypothesis");
    expect(prompt).toContain("Chunk 1 of 5");
  });

  test("buildRollingIntentPrompt subsequent chunk includes prior intent", () => {
    const prior = JSON.stringify({ version: 1, coreThesis: "test", logicChain: [] });
    const prompt = buildRollingIntentPrompt(prior, "new chunk", 1, 5);
    expect(prompt).toContain("Current Intent Hypothesis");
    expect(prompt).toContain("Chunk 2 of 5");
  });

  test("parseIntentMapFromResponse handles raw json", () => {
    const raw = JSON.stringify({
      version: 1,
      coreThesis: "Test thesis",
      logicChain: ["A→B", "B→C"],
      hiddenAssumptions: ["Assumption 1"],
      domainMap: {},
      wordCount: 500,
      createdAt: "2026-03-12T00:00:00Z",
    });
    const result = parseIntentMapFromResponse(raw);
    expect(result.coreThesis).toBe("Test thesis");
    expect(result.logicChain).toHaveLength(2);
  });

  test("parseIntentMapFromResponse handles fenced json", () => {
    const raw = "```json\n" + JSON.stringify({
      version: 1,
      coreThesis: "Thesis",
      logicChain: ["X→Y"],
      hiddenAssumptions: [],
      domainMap: {},
      wordCount: 100,
      createdAt: "2026-03-12T00:00:00Z",
    }) + "\n```";
    const result = parseIntentMapFromResponse(raw);
    expect(result.coreThesis).toBe("Thesis");
  });

  test("mergeKnowledgePoints deduplicates by title", () => {
    const kp1: KnowledgePoint = {
      id: "kp_0_0", title: "Test KP", intentRank: 1, intentRole: "test",
      sourceChapter: "Ch1", level: "L1", atomic: false, content: "short",
    };
    const kp2: KnowledgePoint = {
      ...kp1, id: "kp_1_0", content: "longer content with more detail",
    };
    const merged = mergeKnowledgePoints([[kp1], [kp2]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe("longer content with more detail");
  });

  test("generatePanoramicMarkdown includes all sections", () => {
    const intentMap: IntentMap = {
      version: 1,
      coreThesis: "Core thesis here",
      logicChain: ["A→B", "B→C"],
      hiddenAssumptions: ["Assumption 1"],
      domainMap: { "第1章": ["A→B"] },
      wordCount: 1000,
      createdAt: "2026-03-12",
    };
    const md = generatePanoramicMarkdown("Test Material", intentMap, [], "cli", "2026-03-12");
    expect(md).toContain("全景地图");
    expect(md).toContain("核心意图");
    expect(md).toContain("总体进度");
    expect(md).toContain("Core thesis here");
  });
});
