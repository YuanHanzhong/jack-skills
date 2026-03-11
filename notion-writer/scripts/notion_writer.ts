/**
 * notion_writer.ts — Notion write unified layer (instruction-based delegation)
 * ============================================================================
 * TypeScript code cannot call Notion MCP directly. This module uses an
 * "instruction delegation" pattern:
 *   1. Code calls writePendingInstruction(action, params)
 *   2. Instruction written to PENDING_LOGS_DIR / "notion_pending_instruction.json"
 *   3. Claude reads the file next turn and executes the Notion MCP call
 *   4. After execution, deletes the instruction file
 *
 * Fallback: writeFallbackPending() writes a simplified pending entry
 * for later manual processing.
 */

import { join } from "node:path";
import { PENDING_LOGS_DIR } from "../../_shared/paths.ts";
import { TODAY_DB_ID } from "../../_shared/config.ts";


// Instruction file path
export const INSTRUCTION_FILE = join(PENDING_LOGS_DIR, "notion_pending_instruction.json");

// Daily log DB config (dynamically loaded)
const CONFIG_PATH = join(PENDING_LOGS_DIR, "daily_db_config.json");

/**
 * Get the current day's inline DB data_source_id.
 */
export async function getDailyDsId(): Promise<string> {
  try {
    const text = await Bun.file(CONFIG_PATH).text();
    const config = JSON.parse(text);
    return config.data_source_id ?? TODAY_DB_ID;
  } catch {
    return TODAY_DB_ID;
  }
}

/**
 * Generate a natural-language prompt for a Notion MCP call.
 * Claude reads the instruction file and uses this prompt to understand the operation.
 */
export async function buildNotionMcpPrompt(
  properties: Record<string, unknown>,
  dataSourceId = "",
): Promise<string> {
  const dsId = dataSourceId || (await getDailyDsId());
  return (
    `Use the Notion MCP tool to create a page in data source ${dsId} ` +
    `with these properties: ${JSON.stringify(properties)}. ` +
    `Only call notion-create-pages once and return the created page URL.`
  );
}

export interface InstructionResult {
  method: string;
  instruction_file: string;
  instruction: Record<string, unknown>;
}

/**
 * Write a JSON instruction file telling Claude what Notion MCP call to execute.
 */
export async function writePendingInstruction(
  action: string,
  params: Record<string, unknown>,
): Promise<InstructionResult> {
  // Ensure directory exists
  await Bun.write(join(PENDING_LOGS_DIR, ".keep"), "");

  const instruction = {
    action,
    params,
    prompt: await buildNotionMcpPrompt(
      (params.properties ?? {}) as Record<string, unknown>,
      (params.data_source_id ?? "") as string,
    ),
    created_at: new Date().toISOString(),
    executed: false,
  };

  await Bun.write(INSTRUCTION_FILE, JSON.stringify(instruction, null, 2));

  return {
    method: "instruction_delegation",
    instruction_file: INSTRUCTION_FILE,
    instruction,
  };
}

export interface FallbackResult {
  method: string;
  call: Record<string, unknown>;
}

/**
 * Fallback: write a pending entry for Claude Orchestrator to execute manually.
 */
export async function writeFallbackPending(
  entry: Record<string, unknown>,
): Promise<FallbackResult> {
  await Bun.write(join(PENDING_LOGS_DIR, ".keep"), "");

  const dsId = await getDailyDsId();
  const call = {
    action: "CLAUDE_MUST_EXECUTE_notion_create_page",
    data_source_id: dsId,
    properties: {
      "标题": ((entry.title as string) ?? "").slice(0, 120),
      "状态": (entry.status as string) ?? "🔄 进行中",
      "信号类型": (entry.signal_type as string) ?? "🔄 一般对话",
      "轮数": (entry.rounds as number) ?? 1,
      "收获": ((entry.notes as string) ?? "").slice(0, 200),
    },
    entry,
  };

  await Bun.write(
    join(PENDING_LOGS_DIR, "notion_pending_call.json"),
    JSON.stringify(call, null, 2),
  );

  return { method: "fallback_pending", call };
}

/**
 * Read the pending Notion instruction file.
 * Claude calls this at the start of each turn; if there's an instruction, execute the MCP call.
 */
export async function getPendingInstruction(): Promise<Record<string, unknown> | null> {
  try {
    const text = await Bun.file(INSTRUCTION_FILE).text();
    return JSON.parse(text);
  } catch (e) {
    console.warn("[notion_writer] pending instruction read failed:", e);
    return null;
  }
}

/**
 * Called after instruction execution; deletes the instruction file.
 */
export async function markInstructionDone(): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(INSTRUCTION_FILE);
  } catch {
    /* file may not exist — OK */
  }
}
