/**
 * log_writer.ts — Daily activity log writer v2 (Claude semantic judgment version)
 *
 * Architecture:
 *   - Code = write flow + format spec + JSONL buffer management
 *   - Claude = judge signal type, distill summary, analyze pivot reasons
 *   - NEVER use keyword lists to replace Claude's semantic judgment
 */

import { TIMELINE_BUFFER_PATH } from "../_shared/paths.ts";
import { TODAY_DB_ID, LOG_PAGE_ID } from "../_shared/config.ts";
import { getTs, getDisplay } from "../_shared/time_utils.ts";
import { appendJsonl, readJsonl } from "../_shared/jsonl_buffer.ts";

export const BUFFER_PATH = TIMELINE_BUFFER_PATH;
export const TODAY_DB_DATA_SOURCE_ID = TODAY_DB_ID;
export { LOG_PAGE_ID };

// Signal types (filled by Claude, not determined by code)
export const SIGNAL_NORMAL = "📝 普通";
export const SIGNAL_INSIGHT = "💡 收获";
export const SIGNAL_PIVOT = "🔀 转折";
export const SIGNAL_EMOTION = "🌡️ 情绪";
export const SIGNAL_ABANDON = "❌ 放弃";
export const SIGNAL_INTERRUPT = "⏸️ 打断";
export const SIGNAL_COMPLETE = "✅ 完成";

export interface LogRecord {
  ts: string;
  ts_display: string;
  pid: string;
  summary: string;
  signal: string;
  insight: string;
  pivot_reason: string;
  synced: boolean;
}

/**
 * Write a log entry to the local JSONL buffer.
 * summary/signal/insight/pivotReason are ALL filled by Claude intelligently.
 */
export async function writeEntry(
  pid: string,
  summary: string,
  signal: string,
  insight = "",
  pivotReason = "",
): Promise<LogRecord> {
  const record: LogRecord = {
    ts: getTs(),
    ts_display: getDisplay(),
    pid,
    summary: summary.slice(0, 20),
    signal,
    insight: insight ? insight.slice(0, 20) : "",
    pivot_reason: pivotReason ? pivotReason.slice(0, 30) : "",
    synced: false,
  };

  await appendJsonl(BUFFER_PATH, record, "log_writer");

  console.log(`${signal} [${record.ts_display}] ${summary.slice(0, 20)}`);
  return record;
}

/**
 * Read all records from today.
 */
export async function readToday(): Promise<LogRecord[]> {
  const text = await Bun.file(BUFFER_PATH).text().catch((e: unknown) => { console.warn("[log_writer] file read failed:", e); return ""; });
  if (!text) return [];

  const today = getTs().slice(0, 6);
  return readJsonl<LogRecord>(text)
    .filter((r) => (r.ts ?? "").slice(0, 6) === today)
    .sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));
}

/**
 * Build timeline text (for insights-analyzer).
 * Code handles formatting only; content was filled by Claude at write time.
 */
export function buildTimelineText(records: LogRecord[]): string {
  if (!records.length) return "（今天暂无记录）";

  const lines: string[] = [];
  let lastHour: string | null = null;

  for (const r of records) {
    const display = r.ts_display ?? "";
    const hour = display.length > 13 ? display.slice(11, 13) : "??";
    const signal = r.signal ?? "📝 普通";
    const summary = r.summary ?? "";
    const pid = r.pid ?? "";
    const insight = r.insight ?? "";
    const pivotReason = r.pivot_reason ?? "";

    if (hour !== lastHour) {
      lines.push(`\n🕐 ${hour}:xx`);
      lastHour = hour;
    }

    let line = `> ${signal} ${display.slice(11, 16)} · #${pid} · ${summary}`;
    if (insight) line += `\n>> 💡 ${insight}`;
    if (pivotReason) line += `\n>> 🔀 原因：${pivotReason}`;
    lines.push(line);
  }

  return lines.join("\n");
}

// ============================================================
// Claude log write protocol
// ============================================================

export const CLAUDE_LOG_PROTOCOL = `
【每轮日志写入协议·Claude执行标准】

每轮对话结束后，Claude执行：

Step 1·语义理解（禁止关键词匹配）
  判断这轮对话的本质：
  - 正在推进目标 → 📝 普通
  - 用户有认知跃迁 → 💡 收获（同时触发insight_sync）
  - 用户切换方向 → 🔀 转折（分析为什么转折）
  - 用户表达情绪 → 🌡️ 情绪（记录状态）
  - 用户要离开 → ⏸️ 打断（推测原因）
  - 用户放弃目标 → ❌ 放弃（记录原因）
  - 目标完成 → ✅ 完成

Step 2·Claude提炼摘要（<20字，精华不是截断）

Step 3·代码写入
  import { writeEntry } from "./log_writer.ts";
  await writeEntry(currentPid, "确认双轨写入架构方案", "📝 普通");
`;
