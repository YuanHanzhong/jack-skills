/**
 * sync_service.ts
 * ---------------
 * Environment detection + Notion-primary sync strategy.
 *
 * Architecture:
 *   CLI environment  → dual-write: Notion (primary) + local SQLite (cache)
 *   Cloud environment → Notion only (no filesystem access)
 *
 * Source of truth is ALWAYS Notion.
 * Local SQLite is a session cache; overwritten by Notion on session start.
 *
 * Notion DWD page structure:
 *   [Top]    Panoramic map (user-visible markdown)
 *   [Bottom] Folded system section (JSON code blocks for state + intentMap)
 *
 * System section markers used for parse/update:
 *   <!-- SYS_START --> ... <!-- SYS_END -->
 */

import type { IntentMap, AtomicKnowledgePoint, LearningArchiveState } from "./three_pass_scanner.ts";
import { generatePanoramicMarkdown, generateSystemSectionMarkdown } from "./three_pass_scanner.ts";
import { DWD_DATA_SOURCE_ID, ADS_DATA_SOURCE_ID } from "../_shared/config.ts";
import { DwdWriter } from "./text_to_notion_writer.ts";

// ── Environment Detection ────────────────────────────────────────────────────

let _envCache: "cli" | "cloud" | null = null;

/**
 * Detect whether we're running in CLI (has Node/Bun fs) or cloud (no fs).
 * Uses dynamic import to probe for `node:fs` rather than checking `process`
 * since cloud environments may also have a `process` object.
 */
export async function detectEnvironment(): Promise<"cli" | "cloud"> {
  if (_envCache !== null) return _envCache;
  try {
    await import("node:fs");
    _envCache = "cli";
  } catch {
    _envCache = "cloud";
  }
  return _envCache;
}

// ── Local SQLite (CLI only) ──────────────────────────────────────────────────

// Lazy import to avoid errors in cloud environments
async function getSqlite() {
  const { Database } = await import("bun:sqlite");
  return Database;
}

function getDbPath(): string {
  // Store in the learning-engine directory
  const base = new URL("../../engine.db", import.meta.url);
  return base.pathname.replace(/^\/([A-Z]:)/, "$1"); // fix Windows /C: → C:
}

async function openDb() {
  const Database = await getSqlite();
  const db = new Database(getDbPath(), { create: true });
  db.run(`
    CREATE TABLE IF NOT EXISTS archive_state (
      material_title TEXT PRIMARY KEY,
      phase TEXT NOT NULL DEFAULT 'pass1',
      pass1_chunk_index INTEGER NOT NULL DEFAULT 0,
      pass1_total_chunks INTEGER NOT NULL DEFAULT 0,
      pass2_chunk_index INTEGER NOT NULL DEFAULT 0,
      pass3_done INTEGER NOT NULL DEFAULT 0,
      intent_map_version INTEGER NOT NULL DEFAULT 0,
      dwd_page_id TEXT,
      last_updated TEXT NOT NULL,
      intent_map_json TEXT,
      state_json TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS concepts (
      id TEXT PRIMARY KEY,
      material_title TEXT NOT NULL,
      title TEXT NOT NULL,
      intent_rank INTEGER NOT NULL DEFAULT 1,
      intent_role TEXT,
      source_chapter TEXT,
      level TEXT NOT NULL DEFAULT 'L1',
      content TEXT,
      status TEXT NOT NULL DEFAULT '⬜',
      mastery_score INTEGER NOT NULL DEFAULT 0,
      read_count INTEGER NOT NULL DEFAULT 0,
      test_count INTEGER NOT NULL DEFAULT 0,
      consecutive_correct INTEGER NOT NULL DEFAULT 0,
      last_tested TEXT,
      next_review TEXT,
      notion_ads_id TEXT,
      updated_at TEXT NOT NULL
    )
  `);
  return db;
}

/**
 * Save archive state to local SQLite. CLI only.
 */
export async function saveLocalState(
  state: LearningArchiveState,
  intentMap: IntentMap | null,
): Promise<void> {
  const env = await detectEnvironment();
  if (env !== "cli") return;
  const db = await openDb();
  db.run(
    `INSERT OR REPLACE INTO archive_state
      (material_title, phase, pass1_chunk_index, pass1_total_chunks,
       pass2_chunk_index, pass3_done, intent_map_version, dwd_page_id,
       last_updated, intent_map_json, state_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      state.materialTitle,
      state.phase,
      state.pass1ChunkIndex,
      state.pass1TotalChunks,
      state.pass2ChunkIndex,
      state.pass3Done ? 1 : 0,
      state.intentMapVersion,
      state.dwdPageId ?? null,
      state.lastUpdated,
      intentMap ? JSON.stringify(intentMap) : null,
      JSON.stringify(state),
    ],
  );
}

/**
 * Load archive state from local SQLite. Returns null if not found.
 */
export async function loadLocalState(materialTitle: string): Promise<{
  state: LearningArchiveState;
  intentMap: IntentMap | null;
} | null> {
  const env = await detectEnvironment();
  if (env !== "cli") return null;
  const db = await openDb();
  const row = db
    .query<any, [string]>(
      `SELECT state_json, intent_map_json FROM archive_state WHERE material_title = ?`,
    )
    .get(materialTitle);
  if (!row) return null;
  return {
    state: JSON.parse(row.state_json) as LearningArchiveState,
    intentMap: row.intent_map_json ? JSON.parse(row.intent_map_json) : null,
  };
}

/**
 * Save atomic knowledge points to local SQLite. CLI only.
 */
export async function saveLocalConcepts(
  materialTitle: string,
  points: AtomicKnowledgePoint[],
): Promise<void> {
  const env = await detectEnvironment();
  if (env !== "cli") return;
  const db = await openDb();
  const now = new Date().toISOString();
  for (const p of points) {
    db.run(
      `INSERT OR REPLACE INTO concepts
        (id, material_title, title, intent_rank, intent_role, source_chapter,
         level, content, status, mastery_score, read_count, test_count,
         consecutive_correct, last_tested, next_review, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.id, materialTitle, p.title, p.intentRank, p.intentRole ?? null,
        p.sourceChapter ?? null, p.level, p.content ?? null,
        p.status, p.masteryScore, p.readCount, p.testCount,
        p.consecutiveCorrect, p.lastTested ?? null, p.nextReview ?? null, now,
      ],
    );
  }
}

// ── Notion System Section Parser ─────────────────────────────────────────────

const SYS_START_MARKER = "<!-- SYS_START -->";
const SYS_END_MARKER = "<!-- SYS_END -->";

/**
 * Extract JSON from a fenced code block in a string.
 * Returns null if not found.
 */
function extractJsonBlock(text: string, label: string): any | null {
  const labelPattern = new RegExp(`${label}[^\\n]*\\n\\s*\`\`\`json\\s*\\n([\\s\\S]*?)\\n\\s*\`\`\``, "i");
  const match = text.match(labelPattern);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

/**
 * Parse state and intentMap from a Notion DWD page body (markdown string).
 * Looks for the system section between SYS_START and SYS_END markers.
 */
export function parseNotionSystemSection(pageBody: string): {
  state: LearningArchiveState | null;
  intentMap: IntentMap | null;
} {
  const startIdx = pageBody.indexOf(SYS_START_MARKER);
  const endIdx = pageBody.indexOf(SYS_END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    return { state: null, intentMap: null };
  }
  const sysSection = pageBody.slice(startIdx, endIdx + SYS_END_MARKER.length);
  return {
    state: extractJsonBlock(sysSection, "断点续传"),
    intentMap: extractJsonBlock(sysSection, "意图地图"),
  };
}

// ── Notion Read/Write ─────────────────────────────────────────────────────────

/**
 * Build the full DWD page content: panoramic map + system section.
 */
export function buildDwdPageContent(
  materialTitle: string,
  intentMap: IntentMap,
  atomicPoints: AtomicKnowledgePoint[],
  state: LearningArchiveState,
  env: "cli" | "cloud",
): string {
  const now = new Date().toISOString().slice(0, 10);
  const panorama = generatePanoramicMarkdown(materialTitle, intentMap, atomicPoints, env, now);
  const sysMd = generateSystemSectionMarkdown(state, intentMap);

  return [
    panorama,
    "",
    "---",
    "",
    SYS_START_MARKER,
    sysMd,
    SYS_END_MARKER,
  ].join("\n");
}

/**
 * Build the "update system section only" content_updates payload for Notion.
 * Used when updating state/intentMap without re-rendering the full panoramic map.
 */
export function buildSystemSectionUpdate(
  state: LearningArchiveState,
  intentMap: IntentMap,
): { old_str: string; new_str: string } {
  // We replace everything between the markers
  const newSys = generateSystemSectionMarkdown(state, intentMap);
  return {
    old_str: SYS_START_MARKER,
    new_str: SYS_START_MARKER + "\n" + newSys,
  };
}

/**
 * Sync material learning state and knowledge points to Notion.
 *
 * IMPORTANT: This function only builds the write plan (data structures).
 * Actual Notion MCP calls must be made by the calling Agent using the
 * returned plan, because MCP tools are not available in pure TS modules.
 *
 * Returns a write plan describing what to call.
 */
export function buildNotionWritePlan(opts: {
  materialTitle: string;
  intentMap: IntentMap;
  atomicPoints: AtomicKnowledgePoint[];
  state: LearningArchiveState;
  env: "cli" | "cloud";
  existingDwdPageId: string | null;
}): {
  action: "create_dwd" | "update_dwd";
  dwdPageId: string | null;
  dwdContent: string;
  dwdTitle: string;
  adsRecords: Array<{
    title: string;
    properties: Record<string, any>;
  }>;
} {
  const dwdContent = buildDwdPageContent(
    opts.materialTitle,
    opts.intentMap,
    opts.atomicPoints,
    opts.state,
    opts.env,
  );

  const dwdTitle = `🔬 ${opts.materialTitle}｜拆解笔记（三遍扫描）`;

  // Build ADS records for each atomic knowledge point.
  // Delegate to DwdWriter.buildAtomicPointAdsProps() so schema resolution
  // (resolve/buildProps) is kept in one place.
  const adsRecords = opts.atomicPoints.map((p) => ({
    title: p.title,
    properties: DwdWriter.buildAtomicPointAdsProps({
      title: p.title,
      flashcardStatus: p.status,
      masteryScore: p.masteryScore,
      consecutiveCorrect: p.consecutiveCorrect,
      lastTested: p.lastTested,
      sourceChapter: p.sourceChapter ?? "",
      intentRank: p.intentRank,
      intentRole: p.intentRole ?? "",
      level: p.level,
      readCount: p.readCount,
      testCount: p.testCount,
      dwdPageId: opts.existingDwdPageId ?? undefined,
    }),
  }));

  return {
    action: opts.existingDwdPageId ? "update_dwd" : "create_dwd",
    dwdPageId: opts.existingDwdPageId,
    dwdContent,
    dwdTitle,
    adsRecords,
  };
}

/**
 * Reconcile local state with Notion state.
 * Notion is authoritative: if Notion state is newer, use it.
 * Returns the winning state.
 */
export function reconcileState(
  localState: LearningArchiveState | null,
  notionState: LearningArchiveState | null,
): LearningArchiveState | null {
  if (!localState && !notionState) return null;
  if (!localState) return notionState;
  if (!notionState) return localState;

  const localTime = new Date(localState.lastUpdated).getTime();
  const notionTime = new Date(notionState.lastUpdated).getTime();

  // Notion wins if it's newer or equal
  return notionTime >= localTime ? notionState : localState;
}

/**
 * Build an initial LearningArchiveState for a new material.
 */
export function buildInitialState(
  materialTitle: string,
  totalChunks: number,
): LearningArchiveState {
  return {
    materialTitle,
    phase: "pass1",
    pass1ChunkIndex: 0,
    pass1TotalChunks: totalChunks,
    pass2ChunkIndex: 0,
    pass3Done: false,
    intentMapVersion: 0,
    dwdPageId: null,
    lastUpdated: new Date().toISOString(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

import { describe, test, expect } from "bun:test";

describe("SyncService", () => {
  test("detectEnvironment returns cli in bun/node", async () => {
    const env = await detectEnvironment();
    expect(env).toBe("cli");
  });

  test("parseNotionSystemSection extracts state and intentMap", () => {
    const state: LearningArchiveState = {
      materialTitle: "Test",
      phase: "pass2",
      pass1ChunkIndex: 3,
      pass1TotalChunks: 3,
      pass2ChunkIndex: 1,
      pass3Done: false,
      intentMapVersion: 1,
      dwdPageId: "abc123",
      lastUpdated: "2026-03-12T00:00:00Z",
    };
    const intentMap: IntentMap = {
      version: 1,
      coreThesis: "Test thesis",
      logicChain: ["A→B"],
      hiddenAssumptions: [],
      domainMap: {},
      wordCount: 1000,
      createdAt: "2026-03-12",
    };

    const body = [
      "# Panoramic Map",
      "",
      "---",
      "",
      SYS_START_MARKER,
      "  断点续传：",
      "  ```json",
      "  " + JSON.stringify(state),
      "  ```",
      "",
      "  意图地图 v1（2026-03-12）：",
      "  ```json",
      "  " + JSON.stringify(intentMap),
      "  ```",
      SYS_END_MARKER,
    ].join("\n");

    const parsed = parseNotionSystemSection(body);
    expect(parsed.state?.phase).toBe("pass2");
    expect(parsed.intentMap?.coreThesis).toBe("Test thesis");
  });

  test("reconcileState prefers Notion when newer", () => {
    const local: LearningArchiveState = {
      materialTitle: "Test", phase: "pass1",
      pass1ChunkIndex: 1, pass1TotalChunks: 5,
      pass2ChunkIndex: 0, pass3Done: false,
      intentMapVersion: 1, dwdPageId: null,
      lastUpdated: "2026-03-10T00:00:00Z",
    };
    const notion: LearningArchiveState = {
      ...local, phase: "pass2", pass1ChunkIndex: 5, pass2ChunkIndex: 2,
      lastUpdated: "2026-03-12T00:00:00Z",
    };
    const result = reconcileState(local, notion);
    expect(result?.phase).toBe("pass2");
  });

  test("reconcileState prefers local when Notion is older", () => {
    const local: LearningArchiveState = {
      materialTitle: "Test", phase: "pass3",
      pass1ChunkIndex: 5, pass1TotalChunks: 5,
      pass2ChunkIndex: 5, pass3Done: false,
      intentMapVersion: 2, dwdPageId: "xyz",
      lastUpdated: "2026-03-13T00:00:00Z",
    };
    const notion: LearningArchiveState = {
      ...local, phase: "pass2",
      lastUpdated: "2026-03-11T00:00:00Z",
    };
    const result = reconcileState(local, notion);
    expect(result?.phase).toBe("pass3");
  });

  test("buildInitialState sets phase to pass1", () => {
    const state = buildInitialState("My Book", 8);
    expect(state.phase).toBe("pass1");
    expect(state.pass1TotalChunks).toBe(8);
    expect(state.dwdPageId).toBeNull();
  });

  test("buildNotionWritePlan returns create_dwd for new material", () => {
    const intentMap: IntentMap = {
      version: 1, coreThesis: "Test", logicChain: ["A→B"],
      hiddenAssumptions: [], domainMap: {}, wordCount: 100,
      createdAt: "2026-03-12",
    };
    const state = buildInitialState("My Book", 2);
    const plan = buildNotionWritePlan({
      materialTitle: "My Book",
      intentMap,
      atomicPoints: [],
      state,
      env: "cli",
      existingDwdPageId: null,
    });
    expect(plan.action).toBe("create_dwd");
    expect(plan.dwdTitle).toContain("My Book");
    expect(plan.dwdContent).toContain("全景地图");
    expect(plan.dwdContent).toContain(SYS_START_MARKER);
  });
});
