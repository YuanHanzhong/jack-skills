/**
 * pre-tool-use.ts — PreToolUse Hook Handler (核心守门员)
 * - Non-domain tools: always approve
 * - Domain tools: delegates to the centralized policy engine
 */
import { existsSync, statSync, unlinkSync } from "fs";
import { resolve } from "path";
import { evaluate, LEARNING_ENGINE_TOOLS } from "../../core/policy/engine.ts";
import type { SessionState } from "../../core/state-machine/types.ts";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");
const PANORAMA_FLAG = resolve(process.cwd(), ".learning-engine/state/panorama-active");

/** Estimate file line count without reading content. Returns 0 if file doesn't exist. */
function estimateLines(filePath: string): number {
  try {
    const size = statSync(filePath).size;
    // ~60 bytes per line for CJK-heavy content, ~80 for English
    return Math.ceil(size / 65);
  } catch { return 0; }
}

const LARGE_FILE_LINE_THRESHOLD = 300;

interface ToolInput {
  tool_name: string;
  tool_input: Record<string, any>;
}

type Decision = { decision: "approve" } | { decision: "deny"; reason: string };

export async function handlePreToolUse(input: ToolInput): Promise<Decision> {
  const toolName = input.tool_name;

  // ── Panorama mode: block Read on large files ──
  if (toolName === "Read" && existsSync(PANORAMA_FLAG)) {
    const filePath = input.tool_input?.file_path ?? "";
    if (filePath && existsSync(filePath)) {
      const estLines = estimateLines(filePath);
      if (estLines > LARGE_FILE_LINE_THRESHOLD) {
        return {
          decision: "deny",
          reason: `[全景图模式] 禁止直接 Read 大文件（估算 ${estLines} 行 > ${LARGE_FILE_LINE_THRESHOLD} 行阈值）。`
            + ` 必须用 Task SubAgent 按章节分段读取。先用 Bash(wc -l) 获取准确行数和 Bash(grep -n "^#") 获取标题位置，`
            + ` 然后按章节拆成多个 SubAgent（每个≤500行）。`,
        };
      }
    }
  }

  // Non-domain tools → unconditional approve
  if (!(LEARNING_ENGINE_TOOLS as readonly string[]).includes(toolName)) {
    return { decision: "approve" };
  }

  // If no DB, approve (system not initialized yet)
  if (!existsSync(DB_PATH)) {
    return { decision: "approve" };
  }

  const { Database } = await import("bun:sqlite");
  const sqlite = new Database(DB_PATH, { readonly: true });
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  try {
    const session = sqlite
      .query(
        `SELECT status FROM sessions WHERE status != 'DONE' AND status != 'FAILED'
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get() as { status: string } | null;

    if (!session) {
      return { decision: "approve" };
    }

    const result = evaluate(toolName, session.status as SessionState, "PreToolUse", input.tool_input ?? {});

    if (result.decision === "trigger") {
      // Treat trigger as approve at the hook level
      return { decision: "approve" };
    }
    return result;
  } finally {
    sqlite.close();
  }
}
