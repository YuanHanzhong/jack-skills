/**
 * ods_realtime_writer.ts — Realtime ODS writer v1.0
 *
 * Architecture (same as insight_sync.ts):
 *   - Code = flow control + formatting + Notion write
 *   - Claude = smart judgment of activity type / friction / satisfaction / summary
 *   - NEVER use keyword matching to replace Claude judgment
 *
 * Trigger: when each conversation turn has substantive progress (Plan B)
 * Write target: ODS database (13 columns), ID read from metadata page at runtime
 */

import { join } from "node:path";
import { TEMP_BASE } from "../_shared/paths.ts";
import { resolve } from "../_shared/schema_resolver.ts";
import { STATUS_RESOLVED, STATUS_UNRESOLVED } from "../_shared/constants.ts";
import { getDisplay as getTsDisplay, getTsIso } from "../_shared/time_utils.ts";
import { appendJsonl } from "../_shared/jsonl_buffer.ts";

// Local buffer (fallback when Notion write fails)
export const ODS_BUFFER_PATH = join(TEMP_BASE, "ods_realtime_buffer.jsonl");

// Authoritative activity type list (Facet DB is source of truth)
export const ACTIVITY_TYPES = [
  "build", "debug", "refactor", "知识学习",
  "技能创建", "工具优化", "个人成长", "其他",
] as const;

// Authoritative friction point list
export const FRICTION_POINTS = [
  "重复纠错", "范围蔓延", "规则违反", "工具缺口",
  "清晰度问题", "依赖纠缠", "认知负担", "集成摩擦",
] as const;

// Analysis status options (F09: includes "分析中")
export const ANALYSIS_STATUS = ["待分析", "分析中", "已分析", "待复查"] as const;

/**
 * Map satisfaction score to resolved status.
 */
export function mapSatisfactionToResolved(satisfaction: number): string {
  if (satisfaction >= 0.7) return STATUS_RESOLVED;
  if (satisfaction >= 0.4) return "❓部分";
  return STATUS_UNRESOLVED;
}

export interface OdsRow {
  title: string;
  timestamp: string;
  keywords: string[];
  note: string;
  chat_url: string;
  turn_count: number;
  is_resolved: string;
  activity_type: string;
  friction_points: string[];
  satisfaction: number;
  summary: string;
  task_category: string;
  highlight_note: string;
  analysis_status: string;
}

/**
 * Build a complete ODS row data structure.
 * All content fields are filled by Claude intelligently; this function only formats and validates.
 */
export function buildOdsRow(opts: {
  title: string;
  turnCount: number;
  activityType: string;
  frictionPoints?: string[];
  satisfaction?: number;
  keywords?: string[];
  note?: string;
  summary?: string;
  chatUrl?: string;
}): OdsRow {
  const activityType = (ACTIVITY_TYPES as readonly string[]).includes(opts.activityType)
    ? opts.activityType
    : "其他";

  const validFrictions = (opts.frictionPoints ?? []).filter((p) =>
    (FRICTION_POINTS as readonly string[]).includes(p),
  );

  const sat = Math.max(0.0, Math.min(1.0, opts.satisfaction ?? 0.5));

  return {
    title: opts.title.slice(0, 30),
    timestamp: getTsIso(),
    keywords: opts.keywords ?? [],
    note: (opts.note ?? "").slice(0, 20),
    chat_url: opts.chatUrl ?? "",
    turn_count: opts.turnCount,
    is_resolved: mapSatisfactionToResolved(sat),
    activity_type: activityType,
    friction_points: validFrictions,
    satisfaction: sat,
    summary: opts.summary ?? "",
    task_category: "",
    highlight_note: "",
    analysis_status: "待分析",
  };
}

/**
 * Convert buildOdsRow output to Notion create-pages properties format.
 */
export function buildNotionProperties(row: OdsRow): Record<string, unknown> {
  const props: Record<string, unknown> = {
    [resolve("ODS", "title")]: row.title,
    [`date:${resolve("ODS", "timestamp")}:start`]: row.timestamp,
    [`date:${resolve("ODS", "timestamp")}:is_datetime`]: 1,
    [resolve("ODS", "note")]: row.note,
    [resolve("ODS", "turnCount")]: row.turn_count,
    [resolve("ODS", "isResolved")]: row.is_resolved,
    [resolve("ODS", "activityType")]: row.activity_type,
    [resolve("ODS", "satisfaction")]: row.satisfaction,
    [resolve("ODS", "analysisStatus")]: row.analysis_status,
  };

  if (row.keywords.length) {
    props[resolve("ODS", "keywords")] = row.keywords.join(", ");
  }
  if (row.friction_points.length) {
    props[resolve("ODS", "frictionPoints")] = row.friction_points.join(", ");
  }
  if (row.chat_url) {
    props[`userDefined:${resolve("ODS", "chatUrl")}`] = row.chat_url;
  }
  return props;
}

/**
 * Build page body content for an ODS row.
 */
export function buildPageBody(row: OdsRow): string {
  const frictions = row.friction_points.length
    ? row.friction_points.join("、")
    : "无";
  return `## 📋 摘要分析
${row.summary}

## 📊 Facet 字段
> 🔧 活动类型：${row.activity_type}
> 🔧 摩擦点：${frictions}
> 🔧 满意度：${row.satisfaction}
> 🔧 是否解决：${row.is_resolved}
> 🔧 对话轮数：${row.turn_count}
> 🔧 记录时间：${getTsDisplay()} (UTC+8)
> 🔧 写入方式：实时写入（对话进行中）
`;
}

/**
 * Write to local JSONL buffer (fallback when Notion fails).
 */
export async function writeToLocalBuffer(row: OdsRow): Promise<Record<string, unknown>> {
  const record = {
    ts: getTsIso(),
    title: row.title,
    activity_type: row.activity_type,
    synced_to_notion: false,
  };

  await appendJsonl(ODS_BUFFER_PATH, record, "ods_realtime_writer");

  return record;
}

// ============================================================
// Claude realtime ODS write protocol
// ============================================================

export const CLAUDE_ODS_REALTIME_PROTOCOL = `
【实时ODS写入协议·Claude执行标准】

触发时机：每轮对话有实质进展时（不是每轮都写）

Step 1·Claude语义判断（禁止关键词匹配）
  问自己：本轮对话是否产生了可记录的进展？
  → 有进展：进入Step 2
  → 无进展：跳过，不写入

Step 2·Claude提炼字段（全部由LLM判断，代码不做内容决策）
  - 主题（≤30字）
  - 活动类型（8选1）
  - 摩擦点（多选或无）
  - 满意度（0.0~1.0）
  - 关键词（2-4个）
  - 备注（≤20字）
  - 摘要（≤200字）

Step 3·代码格式化
  import { buildOdsRow, buildNotionProperties, buildPageBody } from "./ods_realtime_writer.ts";
  const row = buildOdsRow({ title, turnCount, activityType, ... });
  const props = buildNotionProperties(row);
  const body = buildPageBody(row);

Step 4·Notion写入
  方式A（首选）：从元数据页JSON读取CONV_ODS_DB_ID
  方式B（降级）：从本地缓存读取
  方式C（兜底）：writeToLocalBuffer(row)

Step 5·URL补填轮询（每次写入后顺便执行）
`;
