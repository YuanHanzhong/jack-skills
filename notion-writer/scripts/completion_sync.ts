/**
 * completion_sync.ts — DWS/ADS completion status atomic sync
 * ==========================================================
 * [FIX 2026-03-04] Lesson learned: after ADS marked complete, DWS status never synced automatically.
 *
 * Responsibility:
 *   When ADS task is marked complete, sync-update the corresponding DWS document status.
 *   Atomic operation: ADS + DWS must update together, cannot only change one.
 *
 * Relations:
 *   - Called by skill_runner.completeTask() (recommended entry)
 *   - Referenced by SKILL.md Step 10
 */

import { join } from "node:path";
import { SESSION_DIR } from "../../_shared/paths.ts";
import { resolve } from "../../_shared/schema_resolver.ts";

import { ADS_DATA_SOURCE_ID, DWS_DATA_SOURCE_ID } from "../../_shared/config.ts";
import { STATUS_DONE, STATUS_FAILED, STATUS_IN_PROGRESS } from "../../_shared/constants.ts";
export const ADS_DS = ADS_DATA_SOURCE_ID;
export const DWS_DS = DWS_DATA_SOURCE_ID;
export { STATUS_DONE, STATUS_FAILED, STATUS_IN_PROGRESS };

const LOG_PATH = join(SESSION_DIR, "completion_sync_log.json");

function getTimestamp(): string {
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
  return now.slice(0, 16);
}

async function loadLog(): Promise<unknown[]> {
  try {
    const text = await Bun.file(LOG_PATH).text();
    return JSON.parse(text);
  } catch (e) {
    console.warn("[completion_sync] log load failed:", e);
    return [];
  }
}

async function saveLog(log: unknown[]): Promise<void> {
  const dir = join(LOG_PATH, "..");
  await Bun.write(join(dir, ".keep"), "");
  await Bun.write(LOG_PATH, JSON.stringify(log, null, 2));
}

export interface SyncInstruction {
  step: number | string;
  desc: string;
  tool?: string;
  bash?: string;
  page_id?: string;
  command?: string;
  properties?: Record<string, string>;
  selection_with_ellipsis?: string;
  new_str?: string;
  critical?: boolean;
  error_action?: string;
}

/**
 * Generate ADS + DWS completion status atomic sync MCP call instruction sequence.
 * [CRITICAL/REQUIRED] Status value uses 🟢 已完成 (not ✅ 已完成)
 */
export async function syncCompletionStatus(opts: {
  adsPageId: string;
  dwsPageId: string;
  topic?: string;
  success?: boolean;
  conclusion?: string;
  dryRun?: boolean;
}): Promise<SyncInstruction[]> {
  const {
    adsPageId,
    dwsPageId,
    topic = "任务",
    success = true,
    conclusion = "",
    dryRun = false,
  } = opts;

  const ts = getTimestamp();
  const notionStatus = success ? STATUS_DONE : STATUS_FAILED;
  const progressNote =
    `\n📌 ${ts} ✅ **【${success ? "任务完成" : "任务失败"}】**：` +
    `${conclusion || topic + " 已完结，ADS+DWS 状态同步"}`;

  const instructions: SyncInstruction[] = [
    {
      step: 0,
      desc: "获取真实时间戳",
      bash: "date '+%Y-%m-%d %H:%M'",
    },
    {
      step: 1,
      desc: `更新 ADS 任务状态 → ${notionStatus}`,
      tool: "Notion:notion-update-page",
      page_id: adsPageId,
      command: "update_properties",
      properties: { [resolve("ADS", "status")]: notionStatus },
      critical: true,
      error_action: "停止，不继续（避免状态不一致）",
    },
    {
      step: 2,
      desc: `更新 DWS 文档状态 → ${notionStatus}（[CRITICAL] 必须与Step1同轮执行）`,
      tool: "Notion:notion-update-page",
      page_id: dwsPageId,
      command: "update_properties",
      properties: { [resolve("DWS", "status")]: notionStatus },
      critical: true,
      error_action: "输出 ⚠️ DWS状态更新失败，需手动修复",
    },
    {
      step: 3,
      desc: "在 DWS 进展跟踪末尾追加完成记录",
      tool: "Notion:notion-update-page",
      page_id: dwsPageId,
      command: "insert_content_after",
      selection_with_ellipsis: "## 📝 进展跟踪",
      new_str: progressNote,
      critical: false,
      error_action: "忽略（非关键步骤）",
    },
  ];

  if (!dryRun) {
    const log = await loadLog();
    log.push({
      timestamp: ts,
      topic,
      ads_page_id: adsPageId,
      dws_page_id: dwsPageId,
      status: notionStatus,
      steps: instructions.length,
    });
    await saveLog(log);
  }

  if (dryRun) {
    console.log(`🔍 [dry_run] syncCompletionStatus(${topic})`);
    for (const inst of instructions) {
      console.log(`  Step ${inst.step}: ${inst.desc}`);
    }
    return instructions;
  }

  console.log(`✅ syncCompletionStatus generated ${instructions.length} step instructions`);
  console.log(`   ADS: ${adsPageId}`);
  console.log(`   DWS: ${dwsPageId}`);
  console.log(`   Status: ${notionStatus}`);
  console.log(`   Topic: ${topic}`);
  return instructions;
}

/**
 * Generate MCP query instruction to extract DWS link from ADS note field.
 * Use when dws_page_id is unknown.
 */
export function findDwsFromAds(adsPageId: string): Record<string, unknown> {
  return {
    step: "pre-fetch",
    desc: "⚠️ 中量fetch ADS页面（只读properties中的备注字段·忽略content），提取 DWS UUID",
    tool: "Notion:notion-fetch",
    id: adsPageId,
    extract_hint:
      "在返回的属性中找 '备注' 字段，提取其中的 Notion URL，" +
      "从 URL 末尾解析32位十六进制 UUID（去掉连字符）。" +
      "⚠️ 只读properties·忽略content部分",
  };
}

/**
 * Batch sync multiple ADS+DWS pairs.
 */
export async function batchSync(
  pairs: Array<{ ads: string; dws: string; topic?: string; conclusion?: string }>,
): Promise<SyncInstruction[][]> {
  const results: SyncInstruction[][] = [];
  for (const pair of pairs) {
    const instructions = await syncCompletionStatus({
      adsPageId: pair.ads,
      dwsPageId: pair.dws,
      topic: pair.topic ?? "未命名任务",
      conclusion: pair.conclusion ?? "",
    });
    results.push(instructions);
  }
  console.log(`📦 batchSync: ${pairs.length} task groups generated instruction sequences`);
  return results;
}
